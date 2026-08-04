import { access, mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { aopPaths, resolveExecHost } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";

const GIT_COMMON_DIRECTORY_TTL_MS = 60_000;
const gitCommonDirectoryCache = new Map<string, { expiresAt: number; value: Promise<string> }>();

export class WorkspaceBindingError extends Error {
  readonly code = "WORKSPACE_BINDING_ERROR";

  constructor(
    message: string,
    readonly path: string | null = null,
    readonly resettable = false,
  ) {
    super(message);
    this.name = "WorkspaceBindingError";
  }
}

export const resolveChatWorkspace = async (
  repositoryPath: string,
  boundPath: string | null,
): Promise<string> => {
  const repository = await existingRealPath(repositoryPath, "Repository");
  if (!boundPath) return repository;
  if (!isAbsolute(boundPath)) throw new WorkspaceBindingError("Chat workspace must be absolute");
  const workspace = await existingRealPath(boundPath, "Bound chat workspace", true);
  if (workspace === repository) return workspace;
  const [repositoryCommonDir, workspaceCommonDir] = await Promise.all([
    gitCommonDirectory(repository),
    gitCommonDirectory(workspace),
  ]);
  if (repositoryCommonDir !== workspaceCommonDir) {
    throw new WorkspaceBindingError("Chat workspace must belong to the same Git repository");
  }
  return workspace;
};

export const resolveSessionWorkspaceBinding = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<string> => {
  let resolved: string;
  if (session.repo_id) {
    const repo = await ctx.repoRepository.getById(session.repo_id);
    if (!repo) throw new WorkspaceBindingError("Session repository no longer exists");
    resolved = await resolveChatWorkspace(repo.path, session.workspace_path);
  } else {
    const generalPath = aopPaths.generalChatWorkspace();
    await mkdir(generalPath, { recursive: true });
    resolved = await existingRealPath(
      session.workspace_path ?? generalPath,
      "Bound chat workspace",
      Boolean(session.workspace_path),
    );
  }
  if (session.workspace_path !== resolved) {
    await ctx.chatSessionRepository.update(session.id, {
      workspace_path: resolved,
      updated_at: new Date().toISOString(),
    });
  }
  return resolved;
};

export const setSessionWorkspaceBinding = async (
  ctx: LocalServerContext,
  sessionId: string,
  absolutePath: string | null,
): Promise<ChatSession | null> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return null;
  let workspace: string;
  if (session.repo_id) {
    const repo = await ctx.repoRepository.getById(session.repo_id);
    if (!repo) throw new WorkspaceBindingError("Session repository no longer exists");
    workspace = await resolveChatWorkspace(repo.path, absolutePath);
  } else {
    const fallback = aopPaths.generalChatWorkspace();
    await mkdir(fallback, { recursive: true });
    workspace = await existingRealPath(
      absolutePath ?? fallback,
      "Bound chat workspace",
      Boolean(absolutePath),
    );
  }
  return ctx.chatSessionRepository.update(sessionId, {
    workspace_path: workspace,
    updated_at: new Date().toISOString(),
  });
};

const existingRealPath = async (
  path: string,
  label: string,
  resettable = false,
): Promise<string> => {
  try {
    await access(path);
    return await realpath(path);
  } catch {
    throw new WorkspaceBindingError(`${label} does not exist: ${path}`, path, resettable);
  }
};

const gitCommonDirectory = async (cwd: string): Promise<string> => {
  const pathStat = await stat(cwd);
  const key = `${cwd}:${pathStat.dev}:${pathStat.ino}`;
  const now = Date.now();
  const cached = gitCommonDirectoryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  for (const [cachedKey, entry] of gitCommonDirectoryCache) {
    if (entry.expiresAt <= now) gitCommonDirectoryCache.delete(cachedKey);
  }
  const value = readGitCommonDirectory(cwd).catch((error) => {
    if (gitCommonDirectoryCache.get(key)?.value === value) {
      gitCommonDirectoryCache.delete(key);
    }
    throw error;
  });
  gitCommonDirectoryCache.set(key, {
    expiresAt: now + GIT_COMMON_DIRECTORY_TTL_MS,
    value,
  });
  return value;
};

const readGitCommonDirectory = async (cwd: string): Promise<string> => {
  const proc = resolveExecHost().spawn({
    cmd: ["git", "rev-parse", "--git-common-dir"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout =
    proc.stdout instanceof ReadableStream ? new Response(proc.stdout).text() : Promise.resolve("");
  const [exitCode, output] = await Promise.all([proc.exited, stdout]);
  if (exitCode !== 0) {
    throw new WorkspaceBindingError(`Chat workspace is not a Git repository: ${cwd}`);
  }
  return realpath(resolve(cwd, output.trim()));
};
