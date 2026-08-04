import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { RemoveRepoOptions } from "@aop/common";
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
import type { Task } from "../db/schema.ts";
import { abortTask } from "../executor/index.ts";
import { DEFAULT_SETTINGS, type SettingKey } from "../settings/types.ts";
import { cleanupTaskArtifacts } from "../task-docs/cleanup.ts";
import { extractRepoName } from "./repository.ts";

const logger = getLogger("repos-handlers");

export const setupOpenspecSymlink = (_repoPath: string, _repoId: string): void => {
  // Task docs live in ~/.aop/repos/<repoId>/tasks; do not create repo-local docs/tasks.
};

export type InitRepoResult =
  | { success: true; repoId: string; alreadyExists: boolean }
  | { success: false; error: InitRepoError };

export type InitRepoError = { code: "NOT_A_GIT_REPO"; path: string };

export type RemoveRepoResult =
  | { success: true; repoId: string; abortedTasks: number; factoryReset: boolean }
  | { success: false; error: RemoveRepoError };

export type RemoveRepoError =
  | { code: "NOT_FOUND"; path: string }
  | { code: "HAS_WORKING_TASKS"; count: number }
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
    max_concurrent_tasks: 3,
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
  options: RemoveRepoOptions = {},
): Promise<RemoveRepoResult> => {
  const { repoRepository, taskRepository } = ctx;

  const repo = await repoRepository.getByPath(repoPath);
  if (!repo) {
    logger.warn("Remove repo failed: not found at {path}", { path: repoPath });
    return { success: false, error: { code: "NOT_FOUND", path: repoPath } };
  }

  const workingTasks = await taskRepository.list({
    status: "WORKING",
    repo_id: repo.id,
  });
  if (workingTasks.length > 0 && !options.force) {
    logger.warn("Remove repo blocked: {count} working tasks for {repoId}", {
      count: workingTasks.length,
      repoId: repo.id,
    });
    return {
      success: false,
      error: { code: "HAS_WORKING_TASKS", count: workingTasks.length },
    };
  }

  const abortedTasks = await forceAbortRepoTasks(ctx, repo.id, workingTasks);

  // Hidden checkpoint refs must be gone before anything that identifies the
  // repository or its workspaces is removed, otherwise they can never be found
  // again. A failure here preserves the registration, sessions, and paths.
  const chatPurge = await purgeRepoChatHistory(ctx, repo.id, {
    abortSessions: (sessionIds) => forceAbortChatSessionsForPurge(ctx, sessionIds),
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

  await removeRepoTaskArtifacts(ctx, repo.id, repo.path);
  await deleteRepoOwnedRows(ctx, repo.id);
  await taskRepository.deleteByRepoId(repo.id);

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
  await archiveOrphanedAgents(ctx);

  const factoryReset = (await repoRepository.getAll()).length === 0;
  ctx.taskEventEmitter.emit({ type: "repo-removed", repoId: repo.id });
  if (factoryReset) {
    const reset = await resetAllRuntimeData(ctx);
    if (!reset.success) {
      logger.error("Factory reset after repo removal failed: {message}", {
        message: reset.error.message,
      });
      return { success: false, error: { code: "CHAT_HISTORY_UNSAFE", ...reset.error } };
    }
    ctx.taskEventEmitter.emit({ type: "data-reset" });
  }

  logger.info("Repo removed {repoId} at {path} (aborted {abortedTasks} tasks)", {
    repoId: repo.id,
    path: repoPath,
    abortedTasks,
  });
  return { success: true, repoId: repo.id, abortedTasks, factoryReset };
};

const forceAbortRepoTasks = async (
  ctx: LocalServerContext,
  repoId: string,
  workingTasks: Task[],
): Promise<number> => {
  if (workingTasks.length === 0) return 0;
  logger.info("Force removing repo {repoId}, aborting {count} tasks", {
    repoId,
    count: workingTasks.length,
  });
  return abortWorkingTasks(ctx, workingTasks);
};

const removeRepoTaskArtifacts = async (
  ctx: LocalServerContext,
  repoId: string,
  repoPath: string,
): Promise<void> => {
  const remainingTasks = await ctx.taskRepository.list({
    repo_id: repoId,
    excludeRemoved: true,
  });
  for (const task of remainingTasks) {
    await ctx.executionRepository.deleteAllForTask(task.id);
    await cleanupTaskArtifactsSafely(repoId, repoPath, task);
    if (task.status !== "WORKING") {
      await ctx.taskRepository.markRemoved(task.id);
    }
  }
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

export const getRepoTasks = async (ctx: LocalServerContext, repoId: string) => {
  return ctx.taskRepository.list({ repo_id: repoId, excludeRemoved: true });
};

const abortWorkingTasks = async (ctx: LocalServerContext, tasks: Task[]): Promise<number> => {
  let abortedCount = 0;

  for (const task of tasks) {
    try {
      await abortTask(ctx, task.id);
      abortedCount++;
    } catch (err) {
      logger.error("Failed to abort task {taskId}: {error}", {
        taskId: task.id,
        error: String(err),
        err,
      });
    }
  }

  return abortedCount;
};

const cleanupTaskArtifactsSafely = async (
  repoId: string,
  repoPath: string,
  task: Task,
): Promise<void> => {
  try {
    await cleanupTaskArtifacts({
      repoId,
      repoPath,
      taskId: task.id,
      changePath: task.change_path,
      worktreePath: task.worktree_path,
    });
  } catch (error) {
    logger.warn("Failed to clean artifacts for task {taskId}: {error}", {
      taskId: task.id,
      error: String(error),
    });
  }
};

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

/**
 * SQLite only enforces foreign keys when `PRAGMA foreign_keys` is enabled and
 * this connection never enables it, so the schema's ON DELETE CASCADE clauses
 * are inert at runtime. Purge every repo-owned row explicitly instead of
 * trusting cascades.
 */
const deleteRepoOwnedRows = async (ctx: LocalServerContext, repoId: string): Promise<void> => {
  const taskIds = (
    await ctx.db.selectFrom("tasks").select("id").where("repo_id", "=", repoId).execute()
  ).map((row) => row.id);
  const channelIds = (
    await ctx.db.selectFrom("channels").select("id").where("repo_id", "=", repoId).execute()
  ).map((row) => row.id);

  if (taskIds.length > 0) {
    await ctx.db.deleteFrom("task_dependencies").where("task_id", "in", taskIds).execute();
    await ctx.db
      .deleteFrom("task_dependencies")
      .where("depends_on_task_id", "in", taskIds)
      .execute();
  }
  if (channelIds.length > 0) {
    await ctx.db.deleteFrom("channel_messages").where("channel_id", "in", channelIds).execute();
    await ctx.db.deleteFrom("channel_memberships").where("channel_id", "in", channelIds).execute();
  }
  await ctx.db.deleteFrom("channels").where("repo_id", "=", repoId).execute();
  await ctx.db.deleteFrom("scheduler_triggers").where("repo_id", "=", repoId).execute();
  await ctx.db.deleteFrom("signals").where("repo_id", "=", repoId).execute();
  await ctx.db.deleteFrom("task_assignments").where("repo_id", "=", repoId).execute();
  await ctx.db.deleteFrom("task_sources").where("repo_id", "=", repoId).execute();
  await ctx.db.deleteFrom("agent_repo_memberships").where("repo_id", "=", repoId).execute();
};

/** Main session dir plus delegate/control siblings created by chat runtimes. */
const chatSessionArtifactDirs = (sessionId: string): string[] => {
  const root = join(aopPaths.logs(), "chat-sessions");
  return [
    join(root, sessionId),
    join(root, `${sessionId}-delegate`),
    join(root, `${sessionId}-control`),
  ];
};

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
 * A worker whose only repository was just purged has nothing left to act on:
 * archive it (matching the dashboard's worker-delete semantics) and scrub its
 * artifact directory. Workers shared with other repos are untouched.
 */
const archiveOrphanedAgents = async (ctx: LocalServerContext): Promise<void> => {
  const agents = await ctx.agentRepository.list();
  for (const agent of agents) {
    if (agent.status === "archived") {
      continue;
    }
    const memberships = await ctx.agentRepository.listRepoMemberships(agent.id);
    if (memberships.length > 0) {
      continue;
    }
    await ctx.agentRepository.update(agent.id, { status: "archived" });
    await removePathSafely(aopPaths.agent(agent.id), "agent artifacts");
    logger.info("Archived orphaned worker {agentId} after repo removal", { agentId: agent.id });
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
  await ctx.workflowService.listWorkflows();
  return { success: true };
};

const removeChatSessionArtifacts = async (
  purge: ChatHistoryMaintenanceResult & { success: true },
): Promise<void> => {
  for (const sessionId of purge.deletedSessionIds) {
    for (const dir of chatSessionArtifactDirs(sessionId)) {
      await removePathSafely(dir, "chat session artifacts");
    }
  }
};

const deleteUserDataRows = async (ctx: LocalServerContext): Promise<void> => {
  // Chat tables are absent here on purpose: the chat domain already removed
  // every session graph after confirming its refs were deleted.
  const tables = [
    "runtime_events",
    "step_logs",
    "step_executions",
    "executions",
    "channel_messages",
    "channel_memberships",
    "channels",
    "scheduler_triggers",
    "signals",
    "task_assignments",
    "task_sources",
    "task_dependencies",
    "tasks",
    "agent_repo_memberships",
    "agents",
    "repos",
    "workflow_skill_blocks",
    "workflows",
    "settings",
  ] as const;

  for (const table of tables) {
    await ctx.db.deleteFrom(table).execute();
  }
  // Unfinished jobs must survive a reset; only confirmed deletions are pruned.
  await deleteCompletedCleanupJobs(ctx.db);
};

const resetRuntimeDirs = async (): Promise<void> => {
  const dirs = [
    join(aopPaths.home(), "repos"),
    join(aopPaths.home(), "worktrees"),
    aopPaths.agents(),
    aopPaths.logs(),
  ];

  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
};
