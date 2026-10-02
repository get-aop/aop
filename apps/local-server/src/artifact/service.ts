import {
  ARTIFACT_LIMITS,
  type ArtifactDetail,
  type ArtifactKind,
  type ArtifactResultRef,
  artifactKindOf,
  codeLanguageOf,
  LIBRARY_LIMITS,
} from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { LibraryArtifactRow } from "../db/artifacts-schema.ts";
import type { ChatSession } from "../db/schema.ts";
import { readAgentFile } from "../library/agent-file.ts";
import { libraryMimeType } from "../library/file-type.ts";
import { createLibraryRepository, type LibraryItemWithSession } from "../library/repository.ts";
import type { LibraryError, LibraryService } from "../library/service.ts";
import { blobPath, putBlob, withLibraryLock } from "../library/store.ts";
import { checkArtifactContent } from "./content-check.ts";
import { retentionDaysOf, toArtifactDetail } from "./detail.ts";
import { artifactFileName } from "./naming.ts";
import { createArtifactRepository } from "./repository.ts";

export type ArtifactError =
  | LibraryError
  | { code: "ARTIFACT_NOT_FOUND" }
  | { code: "INVALID_TITLE" }
  | { code: "INVALID_CONTENT"; message: string }
  | { code: "MESSAGE_NOT_FOUND"; message: string }
  | { code: "VISUALIZE_FAILED" };

export type ArtifactResult<T> = ({ success: true } & T) | { success: false; error: ArtifactError };

/** What an agent (or Visualize) hands over: exactly one of `content` or `path`. */
interface ArtifactBody {
  content?: string;
  path?: string;
}

export interface CreateArtifactInput extends ArtifactBody {
  title: string;
  kind?: ArtifactKind;
  language?: string;
  name?: string;
  folder?: string;
  description?: string;
  /** Visualize: the reply the diagram was drawn from, and the type it was drawn as. */
  originMessageId?: string;
  originType?: string;
}

export interface UpdateArtifactInput extends ArtifactBody {
  artifactId: string;
  title?: string;
  kind?: ArtifactKind;
  note?: string;
  originType?: string;
}

export interface ArtifactSaved {
  artifact: ArtifactDetail;
  /** What the chat's card shows: the tool result's marker line carries it. */
  ref: ArtifactResultRef;
}

export interface ArtifactService {
  create: (
    session: ChatSession,
    input: CreateArtifactInput,
  ) => Promise<ArtifactResult<ArtifactSaved>>;
  /** A new version; a Library file that is not an artifact yet becomes one, its file version 1. */
  update: (
    session: ChatSession,
    input: UpdateArtifactInput,
  ) => Promise<ArtifactResult<ArtifactSaved>>;
  /** Any Library item as the view reads it: an artifact with its versions, or a file as one. */
  get: (projectId: string, itemId: string) => Promise<ArtifactResult<{ artifact: ArtifactDetail }>>;
  /** Where a version's bytes are, for the content route. */
  versionContent: (
    projectId: string,
    itemId: string,
    version: number,
  ) => Promise<ArtifactResult<{ path: string; mimeType: string; name: string }>>;
  /** The diagram Visualize drew from a reply, if one is still in the Library. */
  byOriginMessage: (projectId: string, messageId: string) => Promise<ArtifactDetail | null>;
  /**
   * A file in the workspace of one of the project's chats (a path a reply linked): a thread's, or
   * the coordinator's for no thread. Read under the
   * rules an agent's save follows: inside the workspace, never `.git`, within the size limit.
   */
  workspaceFile: (
    projectId: string,
    threadId: string | null,
    path: string,
  ) => Promise<ArtifactResult<{ bytes: Uint8Array; mimeType: string; name: string }>>;
  /** Keeps a linked workspace file in the Library, as an artifact. */
  saveWorkspaceFile: (
    projectId: string,
    threadId: string | null,
    path: string,
  ) => Promise<ArtifactResult<ArtifactSaved>>;
}

export const createArtifactService = (
  ctx: LocalServerContext,
  library: LibraryService,
): ArtifactService => {
  const env: Env = {
    ctx,
    library,
    items: createLibraryRepository(ctx.db),
    artifacts: createArtifactRepository(ctx.db),
  };
  return {
    create: (session, input) => create(env, session, input),
    update: (session, input) => update(env, session, input),
    get: async (projectId, itemId) => {
      const detail = await detailOf(env, projectId, itemId);
      return detail ? { success: true, artifact: detail } : fail({ code: "ARTIFACT_NOT_FOUND" });
    },
    versionContent: (projectId, itemId, version) => versionContent(env, projectId, itemId, version),
    byOriginMessage: async (projectId, messageId) => {
      const row = await env.artifacts.byOriginMessage(projectId, messageId);
      return row ? detailOf(env, projectId, row.item_id) : null;
    },
    workspaceFile: async (projectId, threadId, path) => {
      const session = await sessionOf(env, projectId, threadId);
      if (!session) return fail({ code: "NO_WORKSPACE" });
      const read = await readAgentFile(session.workspace_path, path);
      if (!read.success) return fail(read.error);
      const name = baseName(path);
      return {
        success: true,
        bytes: read.bytes,
        mimeType: libraryMimeType(name, read.bytes),
        name,
      };
    },
    saveWorkspaceFile: async (projectId, threadId, path) => {
      const session = await sessionOf(env, projectId, threadId);
      if (!session) return fail({ code: "NO_WORKSPACE" });
      return create(env, session, {
        title: baseName(path).slice(0, ARTIFACT_LIMITS.titleMaxLength),
        path,
      });
    },
  };
};

// A thread is its chat session; the coordinator's is the project's.
const sessionOf = async (
  env: Env,
  projectId: string,
  threadId: string | null,
): Promise<ChatSession | null> => {
  const sessions = env.ctx.chatSessionRepository;
  const session = threadId
    ? await sessions.getById(threadId)
    : await sessions.getCoordinator(projectId);
  return session?.project_id === projectId ? session : null;
};

const baseName = (path: string): string => path.split(/[/\\]/).filter(Boolean).pop() ?? path;

interface Env {
  ctx: LocalServerContext;
  library: LibraryService;
  items: ReturnType<typeof createLibraryRepository>;
  artifacts: ReturnType<typeof createArtifactRepository>;
}

const create = async (
  env: Env,
  session: ChatSession,
  input: CreateArtifactInput,
): Promise<ArtifactResult<ArtifactSaved>> => {
  const projectId = session.project_id;
  if (!projectId) return fail({ code: "PROJECT_NOT_FOUND" });
  const checked = await checkNew(session, input);
  if (!checked.success) return checked;
  const saved = await env.library.saveFromAgent(session, {
    ...(input.path !== undefined ? { path: input.path } : { content: input.content }),
    name: checked.name,
    folder: input.folder,
    description: input.description,
  });
  if (!saved.success) return saved;
  const row = await env.items.getLive(projectId, saved.item.id);
  if (!row) return fail({ code: "ITEM_NOT_FOUND" });
  // The same file saved again under the same name is the Library's item already there.
  if (!(await env.artifacts.get(row.id))) await recordNew(env, row, checked, input, session);
  return savedResult(env, projectId, row.id, "created");
};

const recordNew = (
  env: Env,
  row: LibraryItemWithSession,
  checked: { title: string; name: string; kind: ArtifactKind },
  input: CreateArtifactInput,
  session: ChatSession,
): Promise<void> =>
  env.artifacts.insert(
    {
      item_id: row.id,
      title: checked.title,
      kind: checked.kind,
      language: checked.kind === "code" ? (input.language ?? codeLanguageOf(checked.name)) : null,
      current_version: 1,
      origin_message_id: input.originMessageId ?? null,
      origin_type: input.originType ?? null,
    },
    firstVersion(row, checked.kind, session),
  );

// A new artifact's title, file name and kind, once its content is known to fit the kind.
const checkNew = async (
  session: ChatSession,
  input: CreateArtifactInput,
): Promise<
  | { success: true; title: string; name: string; kind: ArtifactKind }
  | { success: false; error: ArtifactError }
> => {
  const title = normalizeTitle(input.title);
  if (!title) return fail({ code: "INVALID_TITLE" });
  const body = await readBody(session, input);
  if (!body.success) return body;
  const name = artifactFileName({ ...input, title });
  const mimeType = libraryMimeType(name, body.bytes);
  const kind = input.kind ?? artifactKindOf(name, mimeType);
  const problem = checkArtifactContent(kind, body.bytes, mimeType);
  if (problem) return fail({ code: "INVALID_CONTENT", message: problem });
  return { success: true, title, name, kind };
};

const update = async (
  env: Env,
  session: ChatSession,
  input: UpdateArtifactInput,
): Promise<ArtifactResult<ArtifactSaved>> => {
  const projectId = session.project_id;
  if (!projectId) return fail({ code: "PROJECT_NOT_FOUND" });
  const title = input.title === undefined ? undefined : normalizeTitle(input.title);
  if (title === null) return fail({ code: "INVALID_TITLE" });
  const row = await env.items.getLive(projectId, input.artifactId);
  if (!row || row.source === "chat") return fail({ code: "ARTIFACT_NOT_FOUND" });
  const body = await readBody(session, input);
  if (!body.success) return body;
  const artifact = (await env.artifacts.get(row.id)) ?? (await promote(env, row, session));
  const kind = input.kind ?? artifact.kind;
  const mimeType = libraryMimeType(row.name, body.bytes);
  const problem = checkArtifactContent(kind, body.bytes, mimeType);
  if (problem) return fail({ code: "INVALID_CONTENT", message: problem });

  await withLibraryLock(projectId, async () => {
    const versions = await env.artifacts.versions(row.id);
    const blob = await putBlob(projectId, body.bytes);
    const now = new Date().toISOString();
    await env.artifacts.addVersion(
      {
        item_id: row.id,
        version: (versions.at(-1)?.version ?? 0) + 1,
        sha256: blob.sha256,
        size: blob.size,
        mime_type: mimeType,
        kind,
        note: input.note?.trim().slice(0, ARTIFACT_LIMITS.noteMaxLength) || null,
        session_id: session.id,
        message_id: null,
        created_at: now,
      },
      {
        ...(title ? { title } : {}),
        ...(input.kind ? { kind } : {}),
        ...(input.originType ? { origin_type: input.originType } : {}),
      },
    );
    // A new version is the artifact in use again: its retention starts over.
    await env.items.update(row.id, {
      sha256: blob.sha256,
      size: blob.size,
      mime_type: mimeType,
      updated_at: now,
      last_accessed_at: now,
      added_at: now,
    });
  });
  return savedResult(env, projectId, row.id, "updated");
};

// A Library file an agent updates becomes an artifact: what it held is version 1.
const promote = async (
  env: Env,
  row: LibraryItemWithSession,
  session: ChatSession,
): Promise<LibraryArtifactRow> => {
  const kind = artifactKindOf(row.name, row.mime_type);
  const artifact: LibraryArtifactRow = {
    item_id: row.id,
    title: normalizeTitle(row.name) ?? "Untitled",
    kind,
    language: kind === "code" ? codeLanguageOf(row.name) : null,
    current_version: 1,
    origin_message_id: null,
    origin_type: null,
  };
  await env.artifacts.insert(artifact, firstVersion(row, kind, session));
  return artifact;
};

const firstVersion = (row: LibraryItemWithSession, kind: ArtifactKind, session: ChatSession) => ({
  item_id: row.id,
  version: 1,
  sha256: row.sha256,
  size: row.size,
  mime_type: row.mime_type,
  kind,
  note: null,
  session_id: row.session_id ?? session.id,
  message_id: null,
  created_at: row.created_at,
});

const savedResult = async (
  env: Env,
  projectId: string,
  itemId: string,
  action: ArtifactResultRef["action"],
): Promise<ArtifactResult<ArtifactSaved>> => {
  const artifact = await detailOf(env, projectId, itemId);
  if (!artifact) return fail({ code: "ARTIFACT_NOT_FOUND" });
  return {
    success: true,
    artifact,
    ref: {
      artifactId: artifact.id,
      version: artifact.currentVersion,
      title: artifact.title,
      kind: artifact.kind,
      action,
    },
  };
};

const detailOf = async (
  env: Env,
  projectId: string,
  itemId: string,
): Promise<ArtifactDetail | null> => {
  const row = await env.items.getLive(projectId, itemId);
  if (!row) return null;
  const artifact = await env.artifacts.get(itemId);
  const versions = artifact ? await env.artifacts.versions(itemId) : [];
  const retentionDays = await retentionDaysOf(env.ctx, env.items, projectId);
  return toArtifactDetail(row, artifact, versions, retentionDays);
};

const versionContent = async (
  env: Env,
  projectId: string,
  itemId: string,
  version: number,
): Promise<ArtifactResult<{ path: string; mimeType: string; name: string }>> => {
  const row = await env.items.getLive(projectId, itemId);
  if (!row) return fail({ code: "ARTIFACT_NOT_FOUND" });
  const stored = (await env.artifacts.versions(itemId)).find((at) => at.version === version);
  if (!stored) {
    // A file that is not an artifact is its one version, served as the Library serves it.
    if (version !== 1 || (await env.artifacts.get(itemId)))
      return fail({ code: "ARTIFACT_NOT_FOUND" });
    const content = await env.library.content(projectId, itemId);
    return content.success ? content : fail({ code: "ARTIFACT_NOT_FOUND" });
  }
  const path = blobPath(projectId, stored.sha256);
  if (!(await Bun.file(path).exists())) return fail({ code: "ARTIFACT_NOT_FOUND" });
  await env.items.update(itemId, { last_accessed_at: new Date().toISOString() });
  return { success: true, path, mimeType: stored.mime_type, name: row.name };
};

const readBody = async (
  session: ChatSession,
  input: ArtifactBody,
): Promise<{ success: true; bytes: Uint8Array } | { success: false; error: ArtifactError }> => {
  if ((input.path === undefined) === (input.content === undefined)) {
    return fail({ code: "INVALID_INPUT", message: "Give exactly one of `path` or `content`" });
  }
  if (input.path !== undefined) {
    const read = await readAgentFile(session.workspace_path, input.path);
    return read.success ? read : fail(read.error);
  }
  const bytes = new TextEncoder().encode(input.content);
  if (bytes.length === 0) return fail({ code: "EMPTY_FILE" });
  if (bytes.length > LIBRARY_LIMITS.artifactMaxBytes) {
    return fail({ code: "FILE_TOO_LARGE", maxBytes: LIBRARY_LIMITS.artifactMaxBytes });
  }
  return { success: true, bytes };
};

const normalizeTitle = (title: string): string | null => {
  const trimmed = title.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 && trimmed.length <= ARTIFACT_LIMITS.titleMaxLength ? trimmed : null;
};

const fail = (error: ArtifactError): { success: false; error: ArtifactError } => ({
  success: false,
  error,
});
