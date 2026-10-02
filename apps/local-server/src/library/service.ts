import { join } from "node:path";
import {
  LIBRARY_DEFAULT_FOLDERS,
  LIBRARY_LIMITS,
  type LibraryItem,
  type LibraryItemPatch,
  type LibraryListing,
  type LibrarySettings,
  type LibrarySource,
  normalizeLibraryFolder,
  normalizeLibraryName,
} from "@aop/common";
import { generateTypeId } from "@aop/infra";
import { chatSessionAttachmentsDir } from "../chat-session/message-images.ts";
import type { LocalServerContext } from "../context.ts";
import type { LibraryItemRow } from "../db/library-schema.ts";
import type { ChatSession } from "../db/schema.ts";
import { type AgentFileError, readAgentFile } from "./agent-file.ts";
import { isTextType, libraryMimeType } from "./file-type.ts";
import { effectiveRetention, hostLibraryDefaults, megabytes, toLibraryItem } from "./item-dto.ts";
import { removeLibraryItem } from "./removal.ts";
import { createLibraryRepository, type LibraryRepository } from "./repository.ts";
import { enforceProjectCap } from "./retention.ts";
import { blobPath, putBlob, sha256Of, withLibraryLock } from "./store.ts";

export type LibraryError =
  | { code: "PROJECT_NOT_FOUND" }
  | { code: "ITEM_NOT_FOUND" }
  | { code: "INVALID_NAME" }
  | { code: "INVALID_FOLDER" }
  | { code: "INVALID_INPUT"; message: string }
  | { code: "EMPTY_FILE" }
  | { code: "LIBRARY_FULL"; capBytes: number }
  | { code: "NOT_TEXT" }
  | AgentFileError;

export type LibraryResult<T> = ({ success: true } & T) | { success: false; error: LibraryError };

export interface AgentSaveInput {
  path?: string;
  content?: string;
  name?: string;
  folder?: string;
  description?: string;
}

export interface LibraryService {
  /** The project's items, its storage and the retention that applies to it. */
  list: (projectId: string) => Promise<LibraryResult<{ listing: LibraryListing }>>;
  /** A file the person adds. */
  upload: (
    projectId: string,
    file: { name: string; folder?: string; bytes: Uint8Array },
  ) => Promise<LibraryResult<{ item: LibraryItem }>>;
  /** A file an agent saves for the person, from its workspace or as text it wrote. */
  saveFromAgent: (
    session: ChatSession,
    input: AgentSaveInput,
  ) => Promise<LibraryResult<{ item: LibraryItem }>>;
  update: (
    projectId: string,
    itemId: string,
    patch: LibraryItemPatch,
  ) => Promise<LibraryResult<{ item: LibraryItem }>>;
  remove: (projectId: string, itemId: string) => Promise<LibraryResult<object>>;
  /** Where an item's bytes are, for the content route; reading it counts as using it. */
  content: (
    projectId: string,
    itemId: string,
  ) => Promise<LibraryResult<{ path: string; mimeType: string; name: string }>>;
  /** An item as text, for an agent: text files only, cut at `LIBRARY_LIMITS.readMaxBytes`. */
  readText: (
    projectId: string,
    itemId: string,
  ) => Promise<LibraryResult<{ item: LibraryItem; text: string; truncated: boolean }>>;
  /** Saves the project's own retention choices; the next daily cleanup applies them. */
  setSettings: (
    projectId: string,
    settings: LibrarySettings,
  ) => Promise<LibraryResult<{ listing: LibraryListing }>>;
}

export const createLibraryService = (ctx: LocalServerContext): LibraryService => {
  const repository = createLibraryRepository(ctx.db);
  const env: Env = { ctx, repository };

  return {
    list: async (projectId) => {
      if (!(await projectExists(env, projectId))) return fail({ code: "PROJECT_NOT_FOUND" });
      return { success: true, listing: await listing(env, projectId) };
    },

    upload: async (projectId, file) => {
      if (!(await projectExists(env, projectId))) return fail({ code: "PROJECT_NOT_FOUND" });
      return store(env, projectId, {
        source: "upload",
        name: file.name,
        folder: file.folder,
        description: "",
        bytes: file.bytes,
        sessionId: null,
      });
    },

    saveFromAgent: (session, input) => saveFromAgent(env, session, input),

    // Under the lock, so a pin cannot land between the cleanup choosing an item and removing it.
    update: (projectId, itemId, patch) =>
      withLibraryLock(projectId, async () => {
        const row = await repository.getLive(projectId, itemId);
        if (!row) return fail({ code: "ITEM_NOT_FOUND" });
        const changes = validatePatch(patch);
        if ("error" in changes) return fail(changes.error);
        await repository.update(itemId, { ...changes, updated_at: new Date().toISOString() });
        return itemResult(env, projectId, itemId);
      }),

    remove: async (projectId, itemId) =>
      withLibraryLock(projectId, async () => {
        const row = await repository.getLive(projectId, itemId);
        if (!row) return fail({ code: "ITEM_NOT_FOUND" });
        await removeLibraryItem(repository, row, "deleted", new Date());
        return { success: true };
      }),

    content: async (projectId, itemId) => {
      const row = await repository.getLive(projectId, itemId);
      if (!row) return fail({ code: "ITEM_NOT_FOUND" });
      const path = filePathOf(row);
      if (!(await Bun.file(path).exists())) return fail({ code: "ITEM_NOT_FOUND" });
      await repository.update(itemId, { last_accessed_at: new Date().toISOString() });
      return { success: true, path, mimeType: row.mime_type, name: row.name };
    },

    readText: async (projectId, itemId) => {
      const row = await repository.getLive(projectId, itemId);
      if (!row) return fail({ code: "ITEM_NOT_FOUND" });
      if (!isTextType(row.mime_type)) return fail({ code: "NOT_TEXT" });
      const file = Bun.file(filePathOf(row));
      if (!(await file.exists())) return fail({ code: "ITEM_NOT_FOUND" });
      const bytes = new Uint8Array(await file.slice(0, LIBRARY_LIMITS.readMaxBytes).arrayBuffer());
      await repository.update(itemId, { last_accessed_at: new Date().toISOString() });
      const { retentionDays } = (await retentionFor(env, projectId)).retention;
      return {
        success: true,
        item: toLibraryItem(row, retentionDays),
        text: new TextDecoder().decode(bytes),
        truncated: row.size > LIBRARY_LIMITS.readMaxBytes,
      };
    },

    setSettings: async (projectId, settings) => {
      if (!(await projectExists(env, projectId))) return fail({ code: "PROJECT_NOT_FOUND" });
      await repository.setSettings(projectId, settings);
      return { success: true, listing: await listing(env, projectId) };
    },
  };
};

interface Env {
  ctx: LocalServerContext;
  repository: LibraryRepository;
}

const saveFromAgent = async (
  env: Env,
  session: ChatSession,
  input: AgentSaveInput,
): Promise<LibraryResult<{ item: LibraryItem }>> => {
  if (!session.project_id) return fail({ code: "PROJECT_NOT_FOUND" });
  if ((input.path === undefined) === (input.content === undefined)) {
    return fail({ code: "INVALID_INPUT", message: "Give exactly one of `path` or `content`" });
  }
  const name = input.name ?? (input.path ? baseName(input.path) : undefined);
  if (!name) {
    return fail({ code: "INVALID_INPUT", message: "Give a `name` when you save `content`" });
  }
  const read = await agentBytes(session, input);
  if (!read.success) return read;
  return store(env, session.project_id, {
    source: "artifact",
    name,
    folder: input.folder,
    description: input.description ?? "",
    bytes: read.bytes,
    sessionId: session.id,
  });
};

// The file at `path` in the agent's workspace, or the text it passed as `content`.
const agentBytes = async (
  session: ChatSession,
  input: AgentSaveInput,
): Promise<LibraryResult<{ bytes: Uint8Array }>> => {
  if (input.path !== undefined) {
    const read = await readAgentFile(session.workspace_path, input.path);
    return read.success ? read : fail(read.error);
  }
  const bytes = new TextEncoder().encode(input.content);
  return bytes.length > LIBRARY_LIMITS.artifactMaxBytes
    ? fail({ code: "FILE_TOO_LARGE", maxBytes: LIBRARY_LIMITS.artifactMaxBytes })
    : { success: true, bytes };
};

interface NewItem {
  source: Exclude<LibrarySource, "chat">;
  name: string;
  folder: string | undefined;
  description: string;
  bytes: Uint8Array;
  sessionId: string | null;
}

/**
 * Validates a new file and stores it once per content. The same file saved again under the same
 * name and folder is the item already there. Over the project's cap, the least recently used
 * automatic items make room; a file that would not fit even then is refused.
 */
const store = async (
  env: Env,
  projectId: string,
  file: NewItem,
): Promise<LibraryResult<{ item: LibraryItem }>> => {
  const name = normalizeLibraryName(file.name);
  if (!name) return fail({ code: "INVALID_NAME" });
  const folder = normalizeLibraryFolder(file.folder ?? LIBRARY_DEFAULT_FOLDERS[file.source]);
  if (folder === null) return fail({ code: "INVALID_FOLDER" });
  if (file.description.length > LIBRARY_LIMITS.descriptionMaxLength) {
    return fail({ code: "INVALID_INPUT", message: "The description is too long" });
  }
  const tooLarge = sizeError(file.source, file.bytes.length);
  if (tooLarge) return fail(tooLarge);

  const { retention } = await retentionFor(env, projectId);
  const capBytes = megabytes(retention.capMb);
  const id = await withLibraryLock(projectId, async () => {
    const twin = await env.repository.findTwin(projectId, {
      sha256: sha256Of(file.bytes),
      name,
      folder,
    });
    if (twin) return twin.id;
    if (capBytes !== null && (await keptBytes(env, projectId)) + file.bytes.length > capBytes) {
      return null;
    }
    const blob = await putBlob(projectId, file.bytes);
    const now = new Date();
    const at = now.toISOString();
    const itemId = generateTypeId("lib");
    await env.repository.insert({
      id: itemId,
      project_id: projectId,
      source: file.source,
      name,
      folder,
      description: file.description.trim(),
      mime_type: libraryMimeType(name, file.bytes),
      size: blob.size,
      sha256: blob.sha256,
      session_id: file.sessionId,
      message_id: null,
      attachment_file: null,
      created_at: at,
      added_at: at,
      updated_at: at,
      last_accessed_at: at,
    });
    if (capBytes !== null) {
      await enforceProjectCap(env.repository, projectId, capBytes, now, itemId);
    }
    return itemId;
  });
  if (id === null) return fail({ code: "LIBRARY_FULL", capBytes: capBytes ?? 0 });
  return itemResult(env, projectId, id);
};

// What retention may not take: pinned items and uploads. A new file must fit beside them.
const keptBytes = async (env: Env, projectId: string): Promise<number> => {
  const used = await env.repository.usedBytes(projectId);
  const reclaimable = (await env.repository.evictionCandidates(projectId)).reduce(
    (total, row) => total + row.size,
    0,
  );
  return Math.max(0, used - reclaimable);
};

const sizeError = (source: NewItem["source"], size: number): LibraryError | null => {
  if (size === 0) return { code: "EMPTY_FILE" };
  const maxBytes =
    source === "upload" ? LIBRARY_LIMITS.uploadMaxBytes : LIBRARY_LIMITS.artifactMaxBytes;
  return size > maxBytes ? { code: "FILE_TOO_LARGE", maxBytes } : null;
};

const validatePatch = (
  patch: LibraryItemPatch,
):
  | { name?: string; folder?: string; description?: string; pinned?: 0 | 1 }
  | { error: LibraryError } => {
  const changes: { name?: string; folder?: string; description?: string; pinned?: 0 | 1 } = {};
  if (patch.name !== undefined) {
    const name = normalizeLibraryName(patch.name);
    if (!name) return { error: { code: "INVALID_NAME" } };
    changes.name = name;
  }
  if (patch.folder !== undefined) {
    const folder = normalizeLibraryFolder(patch.folder);
    if (folder === null) return { error: { code: "INVALID_FOLDER" } };
    changes.folder = folder;
  }
  if (patch.description !== undefined) changes.description = patch.description.trim();
  if (patch.pinned !== undefined) changes.pinned = patch.pinned ? 1 : 0;
  return changes;
};

const listing = async (env: Env, projectId: string): Promise<LibraryListing> => {
  const { retention, settings, defaults, hostCapMb } = await retentionFor(env, projectId);
  const rows = await env.repository.listLive(projectId);
  return {
    items: rows.map((row) => toLibraryItem(row, retention.retentionDays)),
    usage: {
      bytes: await env.repository.usedBytes(projectId),
      capBytes: megabytes(retention.capMb),
      hostBytes: await env.repository.usedBytes(null),
      hostCapBytes: megabytes(hostCapMb),
    },
    retention,
    settings,
    defaults,
  };
};

const retentionFor = async (env: Env, projectId: string) => {
  const { hostCapMb, ...defaults } = await hostLibraryDefaults(env.ctx.settingsRepository);
  const settings = await env.repository.getSettings(projectId);
  return { retention: effectiveRetention(settings, defaults), settings, defaults, hostCapMb };
};

const itemResult = async (
  env: Env,
  projectId: string,
  itemId: string,
): Promise<LibraryResult<{ item: LibraryItem }>> => {
  const row = await env.repository.getLive(projectId, itemId);
  if (!row) return fail({ code: "ITEM_NOT_FOUND" });
  const { retention } = await retentionFor(env, projectId);
  return { success: true, item: toLibraryItem(row, retention.retentionDays) };
};

const filePathOf = (row: LibraryItemRow): string =>
  row.source === "chat" && row.session_id && row.attachment_file
    ? join(chatSessionAttachmentsDir(row.session_id), row.attachment_file)
    : blobPath(row.project_id, row.sha256);

const projectExists = async (env: Env, projectId: string): Promise<boolean> =>
  (await env.ctx.projectRepository.getById(projectId)) !== null;

const baseName = (path: string): string => path.split(/[/\\]/).filter(Boolean).pop() ?? "";

const fail = (error: LibraryError): { success: false; error: LibraryError } => ({
  success: false,
  error,
});
