import { getLogger } from "@aop/infra";
import type { Kysely } from "kysely";
import type { LocalServerContext } from "../context.ts";
import type { NewChatCheckpointCleanupJob } from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";
import type { CheckpointGitOptions } from "../session-git/checkpoint-types.ts";
import { processCheckpointCleanupJobs } from "./checkpoint-cleanup-service.ts";
import { type ChatSessionCleanupPlan, planChatSessionCleanup } from "./session-graph-deletion.ts";
import type { MaintenanceScope } from "./session-mutation-lock.ts";

const logger = getLogger("chat-history-maintenance");

export type ChatHistoryMaintenanceFailureReason =
  | "preflight-failed"
  | "cleanup-failed"
  | "stale-preflight";

export interface ChatHistoryMaintenanceFailure {
  reason: ChatHistoryMaintenanceFailureReason;
  message: string;
}

export type ChatHistoryMaintenanceResult =
  | { success: true; deletedSessionIds: string[]; cleanupJobIds: string[] }
  | { success: false; error: ChatHistoryMaintenanceFailure };

export interface ChatHistoryMaintenanceOptions {
  /** Kills provider processes and finalizes durable runs before anything is planned. */
  abortSessions?: (sessionIds: string[]) => Promise<void>;
  processJobs?: typeof processCheckpointCleanupJobs;
  git?: CheckpointGitOptions;
  now?: () => Date;
}

export interface OrphanChatHistory {
  checkpointRunIds: string[];
  revertOperationIds: string[];
}

/**
 * Repo removal: every repo-owned session is preflighted, its refs deleted, and
 * only then are the session graphs removed. A failure at any step leaves the
 * registration, sessions, and workspace paths intact so it can be retried.
 */
export const purgeRepoChatHistory = (
  ctx: LocalServerContext,
  repoId: string,
  options: ChatHistoryMaintenanceOptions = {},
): Promise<ChatHistoryMaintenanceResult> =>
  runMaintenance(ctx, { kind: "repo", repoId }, () => listRepoChatSessionIds(ctx.db, repoId), {
    ...options,
    requireNoOrphans: false,
  });

/**
 * Factory reset: every session plus every orphan checkpoint and revert row must
 * be accounted for before a single row of user data is touched.
 */
export const purgeAllChatHistory = (
  ctx: LocalServerContext,
  options: ChatHistoryMaintenanceOptions = {},
): Promise<ChatHistoryMaintenanceResult> =>
  runMaintenance(ctx, { kind: "global" }, () => listAllChatSessionIds(ctx.db), {
    ...options,
    requireNoOrphans: true,
  });

export const listRepoChatSessionIds = async (
  db: Kysely<Database>,
  repoId: string,
): Promise<string[]> =>
  (
    await db
      .selectFrom("chat_sessions")
      .select("id")
      .where("repo_id", "=", repoId)
      .orderBy("id")
      .execute()
  ).map((row) => row.id);

export const listAllChatSessionIds = async (db: Kysely<Database>): Promise<string[]> =>
  (await db.selectFrom("chat_sessions").select("id").orderBy("id").execute()).map((row) => row.id);

/** Checkpoint and revert rows that no live session graph owns. */
export const listOrphanChatHistory = async (db: Kysely<Database>): Promise<OrphanChatHistory> => {
  const checkpoints = await db
    .selectFrom("chat_run_checkpoints")
    .leftJoin("chat_runs", "chat_runs.id", "chat_run_checkpoints.run_id")
    .leftJoin("chat_sessions", "chat_sessions.id", "chat_runs.session_id")
    .select("chat_run_checkpoints.run_id as run_id")
    .where((eb) => eb.or([eb("chat_runs.id", "is", null), eb("chat_sessions.id", "is", null)]))
    .orderBy("chat_run_checkpoints.run_id")
    .execute();
  const reverts = await db
    .selectFrom("chat_revert_operations")
    .leftJoin("chat_sessions", "chat_sessions.id", "chat_revert_operations.session_id")
    .select("chat_revert_operations.id as id")
    .where("chat_sessions.id", "is", null)
    .orderBy("chat_revert_operations.id")
    .execute();
  return {
    checkpointRunIds: checkpoints.map((row) => row.run_id),
    revertOperationIds: reverts.map((row) => row.id),
  };
};

/** Audit rows may be pruned only once every ref deletion is confirmed complete. */
export const deleteCompletedCleanupJobs = async (db: Kysely<Database>): Promise<void> => {
  await db.deleteFrom("chat_checkpoint_cleanup_jobs").where("status", "=", "completed").execute();
};

const runMaintenance = async (
  ctx: LocalServerContext,
  scope: MaintenanceScope,
  loadSessionIds: () => Promise<string[]>,
  options: ChatHistoryMaintenanceOptions & { requireNoOrphans: boolean },
): Promise<ChatHistoryMaintenanceResult> => {
  const clock = options.now ?? (() => new Date());
  // Abort providers first so the runs they own are finalized before planning.
  await options.abortSessions?.(await loadSessionIds());

  return ctx.sessionMutationLock.withMaintenance(scope, loadSessionIds, async (handle) => {
    const sessionIds = handle.sessionIds;
    // A create that was already in flight when the barrier rose could still
    // have landed after enumeration; refuse rather than orphan its rows.
    const locked = await loadSessionIds();
    if (locked.join(",") !== [...sessionIds].join(",")) {
      return {
        success: false,
        error: {
          reason: "stale-preflight",
          message: `Chat sessions changed while the barrier was raised: expected [${sessionIds.join(",")}], found [${locked.join(",")}]`,
        },
      };
    }

    const preflighted = await preflight(
      ctx,
      sessionIds,
      clock().toISOString(),
      options.requireNoOrphans,
    );
    if (!preflighted.success) return preflighted;

    const jobs = preflighted.plans.flatMap((plan) => plan.jobs);
    await ctx.chatCheckpointCleanupRepository.createMany(jobs);

    const outstanding = await finishCleanup(ctx, jobs, options);
    if (outstanding.length > 0) {
      return {
        success: false,
        error: {
          reason: "cleanup-failed",
          message: `Hidden checkpoint refs are still present for cleanup jobs: ${outstanding.join(", ")}`,
        },
      };
    }

    return deletePreflightedSessions(ctx, preflighted.plans, clock);
  });
};

type PreflightOutcome =
  | { success: true; plans: ChatSessionCleanupPlan[] }
  | { success: false; error: ChatHistoryMaintenanceFailure };

const preflight = async (
  ctx: LocalServerContext,
  sessionIds: string[],
  now: string,
  requireNoOrphans: boolean,
): Promise<PreflightOutcome> => {
  try {
    const plans: ChatSessionCleanupPlan[] = [];
    for (const sessionId of sessionIds) {
      const plan = await planChatSessionCleanup(ctx.db, sessionId, now);
      if (plan) plans.push(plan);
    }
    if (requireNoOrphans) requireNoOrphanRows(await listOrphanChatHistory(ctx.db));
    return { success: true, plans };
  } catch (error) {
    logger.warn("Chat history preflight rejected the destructive operation: {error}", {
      error: String(error),
    });
    return { success: false, error: { reason: "preflight-failed", message: String(error) } };
  }
};

const requireNoOrphanRows = (orphans: OrphanChatHistory): void => {
  if (orphans.checkpointRunIds.length === 0 && orphans.revertOperationIds.length === 0) return;
  throw new Error(
    `Chat history has rows no session owns: checkpoints=[${orphans.checkpointRunIds.join(",")}] reverts=[${orphans.revertOperationIds.join(",")}]`,
  );
};

const deletePreflightedSessions = async (
  ctx: LocalServerContext,
  plans: ChatSessionCleanupPlan[],
  clock: () => Date,
): Promise<ChatHistoryMaintenanceResult> => {
  const deletedSessionIds: string[] = [];
  const cleanupJobIds = plans.flatMap((plan) => plan.jobs.map((job) => job.id));
  for (const plan of plans) {
    try {
      const deletion = await ctx.chatSessionRepository.deleteGraph(plan.sessionId, {
        now: clock().toISOString(),
        expectedUpdatedAt: plan.sessionUpdatedAt,
        expectedCleanupJobIds: plan.jobs.map((job) => job.id),
      });
      if (deletion.deleted) deletedSessionIds.push(plan.sessionId);
    } catch (error) {
      return { success: false, error: { reason: "stale-preflight", message: String(error) } };
    }
  }
  return { success: true, deletedSessionIds, cleanupJobIds };
};

/** Returns the ids of jobs whose refs are not confirmed deleted. */
const finishCleanup = async (
  ctx: LocalServerContext,
  jobs: NewChatCheckpointCleanupJob[],
  options: ChatHistoryMaintenanceOptions,
): Promise<string[]> => {
  const jobIds = jobs.map((job) => job.id);
  if (jobIds.length === 0) return [];

  const processJobs = options.processJobs ?? processCheckpointCleanupJobs;
  await processJobs(
    { repository: ctx.chatCheckpointCleanupRepository, git: options.git },
    { jobIds, limit: jobIds.length, leaseMs: 0 },
  );

  const rows = await ctx.chatCheckpointCleanupRepository.listByIds(jobIds);
  const completed = new Set(rows.filter((row) => row.status === "completed").map((row) => row.id));
  return jobIds.filter((jobId) => !completed.has(jobId));
};
