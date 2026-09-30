import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getRemoteOrigin, listLocalBranches } from "@aop/git-manager";
import { aopPaths, generateTypeId, getLogger, resolveExecHost } from "@aop/infra";
import {
  type ChatHistoryMaintenanceFailureReason,
  type ChatHistoryMaintenanceResult,
  deleteCompletedCleanupJobs,
  purgeAllChatHistory,
  purgeRepoChatHistory,
} from "../chat-session/history-maintenance.ts";
import { forceAbortChatSessionsForPurge } from "../chat-session/service.ts";
import type { LocalServerContext } from "../context.ts";
import { DEFAULT_SETTINGS, type SettingKey } from "../settings/types.ts";
import { announceThreadRemoval } from "../thread/purge-events.ts";
import { extractRepoName } from "./repository.ts";

const logger = getLogger("repos-handlers");

export type InitRepoResult =
  | { success: true; repoId: string; alreadyExists: boolean }
  | { success: false; error: InitRepoError };

export type InitRepoError = { code: "NOT_A_GIT_REPO"; path: string };

export type RemoveRepoResult =
  | { success: true; repoId: string; factoryReset: boolean }
  | { success: false; error: RemoveRepoError };

export type RemoveRepoError =
  | { code: "NOT_FOUND"; path: string }
  | { code: "REPO_IN_PROJECT"; projectNames: string[] }
  | { code: "CHAT_HISTORY_UNSAFE"; reason: ChatHistoryMaintenanceFailureReason; message: string }
  | { code: "REMOVE_FAILED" };

export type ResetRuntimeDataResult =
  | { success: true }
  | {
      success: false;
      error: { reason: ChatHistoryMaintenanceFailureReason; message: string };
    };

export const initRepo = async (
  ctx: LocalServerContext,
  repoPath: string,
): Promise<InitRepoResult> => {
  const { repoRepository } = ctx;

  const isGitRepo = await checkGitRepo(repoPath);
  if (!isGitRepo) {
    logger.warn("Init repo failed: not a git repo at {path}", { path: repoPath });
    return {
      success: false,
      error: { code: "NOT_A_GIT_REPO", path: repoPath },
    };
  }

  const existing = await repoRepository.getByPath(repoPath);
  if (existing) {
    logger.info("Repo already registered {repoId} at {path}", {
      repoId: existing.id,
      path: repoPath,
    });
    return { success: true, repoId: existing.id, alreadyExists: true };
  }

  const name = extractRepoName(repoPath);
  const remoteOrigin = await getRemoteOrigin(repoPath);
  const now = new Date().toISOString();

  const repo = await repoRepository.create({
    id: generateTypeId("repo"),
    path: repoPath,
    name,
    remote_origin: remoteOrigin,
    created_at: now,
    updated_at: now,
  });

  createRepoDirs(repo.id);

  logger.info("Repo initialized {repoId} ({name}) at {path}", {
    repoId: repo.id,
    name,
    path: repoPath,
  });
  return { success: true, repoId: repo.id, alreadyExists: false };
};

export const removeRepo = async (
  ctx: LocalServerContext,
  repoPath: string,
): Promise<RemoveRepoResult> => {
  const { repoRepository } = ctx;

  const repo = await repoRepository.getByPath(repoPath);
  if (!repo) {
    logger.warn("Remove repo failed: not found at {path}", { path: repoPath });
    return { success: false, error: { code: "NOT_FOUND", path: repoPath } };
  }

  // A repo that projects use is a project setting: it leaves through the projects, which tell
  // their clients, and its threads are not deleted as a side effect of unregistering it.
  const usedBy = (await ctx.projectRepository.list()).filter((project) =>
    project.repoIds.includes(repo.id),
  );
  if (usedBy.length > 0) {
    return {
      success: false,
      error: { code: "REPO_IN_PROJECT", projectNames: usedBy.map((project) => project.name) },
    };
  }

  // Hidden checkpoint refs must be gone before anything that identifies the
  // repository or its workspaces is removed, otherwise they can never be found
  // again. A failure here preserves the registration, sessions, and paths.
  const chatPurge = await purgeRepoChatHistory(ctx, repo.id, {
    abortSessions: (sessionIds) => forceAbortChatSessionsForPurge(ctx, sessionIds),
    deletion: announceThreadRemoval,
  });
  if (!chatPurge.success) {
    logger.error("Remove repo blocked: chat history cleanup failed for {repoId}: {message}", {
      repoId: repo.id,
      message: chatPurge.error.message,
    });
    return {
      success: false,
      error: {
        code: "CHAT_HISTORY_UNSAFE",
        reason: chatPurge.error.reason,
        message: chatPurge.error.message,
      },
    };
  }
  await removeChatSessionArtifacts(chatPurge);

  await pruneWorktrees(repo.id, repo.path);

  const removed = await repoRepository.remove(repo.id);
  if (!removed) {
    logger.error("Remove repo failed: repository.remove returned false for {repoId}", {
      repoId: repo.id,
    });
    return { success: false, error: { code: "REMOVE_FAILED" } };
  }

  await removePathSafely(aopPaths.worktrees(repo.id), "repo worktrees");
  await removePathSafely(aopPaths.repoDir(repo.id), "repo artifacts");

  // The last repo going resets all data, which would take repo-less projects with it.
  const factoryReset =
    (await repoRepository.getAll()).length === 0 &&
    (await ctx.projectRepository.list()).length === 0;
  if (factoryReset) {
    const reset = await resetAllRuntimeData(ctx);
    if (!reset.success) {
      logger.error("Factory reset after repo removal failed: {message}", {
        message: reset.error.message,
      });
      return { success: false, error: { code: "CHAT_HISTORY_UNSAFE", ...reset.error } };
    }
  }

  logger.info("Repo removed {repoId} at {path}", { repoId: repo.id, path: repoPath });
  return { success: true, repoId: repo.id, factoryReset };
};

const createRepoDirs = (repoId: string): void => {
  mkdirSync(aopPaths.worktreeMetadata(repoId), { recursive: true });
};

const checkGitRepo = async (path: string): Promise<boolean> => {
  try {
    const proc = resolveExecHost().spawn({
      cmd: ["git", "rev-parse", "--git-dir"],
      cwd: path,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
};

export const listRepoBranches = (
  repoPath: string,
): Promise<{ branches: string[]; current: string }> => listLocalBranches(repoPath);

export const getRepoById = async (ctx: LocalServerContext, repoId: string) => {
  return ctx.repoRepository.getById(repoId);
};

/** Registered repositories as the dashboard lists them (GET /api/status and the SSE init frame). */
export const listRepoSummaries = async (
  ctx: LocalServerContext,
): Promise<{ repos: Array<{ id: string; name: string | null; path: string }> }> => ({
  repos: (await ctx.repoRepository.getAll()).map(({ id, name, path }) => ({ id, name, path })),
});

const pruneWorktrees = async (repoId: string, repoPath: string): Promise<void> => {
  try {
    const proc = resolveExecHost().spawn({
      cmd: ["git", "worktree", "prune"],
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`git worktree prune exited ${exitCode}`);
    }
  } catch (error) {
    logger.warn("Failed to prune worktrees for repo {repoId}: {error}", {
      repoId,
      error: String(error),
    });
  }
};

const chatSessionArtifactDir = (sessionId: string): string =>
  join(aopPaths.logs(), "chat-sessions", sessionId);

const removePathSafely = async (path: string, label: string): Promise<void> => {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    logger.warn("Failed to remove {label} at {path}: {error}", {
      label,
      path,
      error: String(error),
    });
  }
};

/**
 * Two-phase reset: chat history is preflighted and its hidden refs deleted
 * first. Only when that succeeds are user rows, settings, and runtime
 * directories removed, so a cleanup failure never destroys the data needed to
 * retry.
 */
export const resetAllRuntimeData = async (
  ctx: LocalServerContext,
): Promise<ResetRuntimeDataResult> => {
  const chatPurge = await purgeAllChatHistory(ctx, {
    abortSessions: (sessionIds) => forceAbortChatSessionsForPurge(ctx, sessionIds),
    deletion: announceThreadRemoval,
  });
  if (!chatPurge.success) {
    logger.error("Reset blocked: chat history cleanup failed: {message}", {
      message: chatPurge.error.message,
    });
    return { success: false, error: chatPurge.error };
  }
  await removeChatSessionArtifacts(chatPurge);

  await deleteUserDataRows(ctx);
  await ctx.settingsRepository.setAll(
    (Object.entries(DEFAULT_SETTINGS) as [SettingKey, string][]).map(([key, value]) => ({
      key,
      value,
    })),
  );
  await resetRuntimeDirs();
  return { success: true };
};

const removeChatSessionArtifacts = async (
  purge: ChatHistoryMaintenanceResult & { success: true },
): Promise<void> => {
  for (const sessionId of purge.deletedSessionIds) {
    await removePathSafely(chatSessionArtifactDir(sessionId), "chat session artifacts");
  }
};

const deleteUserDataRows = async (ctx: LocalServerContext): Promise<void> => {
  // Chat tables are absent here on purpose: the chat domain already removed
  // every session graph after confirming its refs were deleted. That also
  // satisfies the RESTRICT foreign key from chat_sessions to repos.
  await ctx.db.deleteFrom("repos").execute();
  await ctx.db.deleteFrom("settings").execute();
  // Unfinished jobs must survive a reset; only confirmed deletions are pruned.
  await deleteCompletedCleanupJobs(ctx.db);
};

const resetRuntimeDirs = async (): Promise<void> => {
  const dirs = [
    join(aopPaths.home(), "repos"),
    join(aopPaths.home(), "worktrees"),
    aopPaths.logs(),
  ];

  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
};
