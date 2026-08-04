import type { Kysely } from "kysely";
import type { NewChatCheckpointCleanupJob } from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";
import {
  planCleanupJobs,
  toCheckpointRefRow,
  toRevertRefRow,
} from "./checkpoint-cleanup-manifest.ts";
import { insertChatCheckpointCleanupJobs } from "./checkpoint-cleanup-repository.ts";
import {
  deleteRunGraph,
  listCheckpointsByRunIds,
  listRunIdsBySession,
  listUnfinishedRevertOperations,
} from "./history-rows.ts";

export class StaleChatSessionError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string, message: string) {
    super(message);
    this.name = "StaleChatSessionError";
    this.sessionId = sessionId;
  }
}

export interface ChatSessionCleanupPlan {
  sessionId: string;
  /** Generation token: a session mutated after preflight fails the final commit. */
  sessionUpdatedAt: string;
  jobs: NewChatCheckpointCleanupJob[];
}

export interface DeleteChatSessionGraphOptions {
  now?: string;
  expectedUpdatedAt?: string;
  expectedCleanupJobIds?: readonly string[];
}

export interface DeleteChatSessionGraphResult {
  deleted: boolean;
  cleanupJobIds: string[];
}

/**
 * Reads every checkpoint and unfinished revert operation the session owns and
 * turns them into identity-complete cleanup jobs. Throws when a manifest is
 * malformed or a ref cannot be tied to an exact workspace identity, so callers
 * can stop before touching user data.
 */
export const planChatSessionCleanup = async (
  db: Kysely<Database>,
  sessionId: string,
  now: string,
): Promise<ChatSessionCleanupPlan | null> => {
  const session = await db
    .selectFrom("chat_sessions")
    .select(["id", "updated_at"])
    .where("id", "=", sessionId)
    .executeTakeFirst();
  if (!session) return null;

  const runIds = await listRunIdsBySession(db, sessionId);
  const checkpoints = await listCheckpointsByRunIds(db, runIds);
  // Operations whose cleanup already completed own no live refs.
  const operations = await listUnfinishedRevertOperations(db, sessionId);

  return {
    sessionId,
    sessionUpdatedAt: session.updated_at,
    jobs: planCleanupJobs({
      checkpoints: checkpoints.map(toCheckpointRefRow),
      revertOperations: operations.map(toRevertRefRow),
      runSessionIds: new Map(runIds.map((runId) => [runId, sessionId])),
      now,
    }),
  };
};

/**
 * Deletes the whole session graph in one transaction after saving its cleanup
 * jobs. Planning or insertion failures abort before any row is removed.
 */
export const deleteChatSessionGraph = async (
  db: Kysely<Database>,
  sessionId: string,
  options: DeleteChatSessionGraphOptions = {},
): Promise<DeleteChatSessionGraphResult> =>
  db.transaction().execute(async (trx) => {
    const plan = await planChatSessionCleanup(trx, sessionId, options.now ?? nowIso());
    if (!plan) return { deleted: false, cleanupJobIds: [] };
    requireFreshPlan(plan, options);

    await insertChatCheckpointCleanupJobs(trx, plan.jobs);

    const runIds = await listRunIdsBySession(trx, sessionId);
    await deleteRunGraph(trx, runIds);
    await trx.deleteFrom("chat_revert_operations").where("session_id", "=", sessionId).execute();
    await trx.deleteFrom("chat_messages").where("session_id", "=", sessionId).execute();
    await trx.deleteFrom("chat_sessions").where("id", "=", sessionId).execute();

    return { deleted: true, cleanupJobIds: plan.jobs.map((job) => job.id) };
  });

const requireFreshPlan = (
  plan: ChatSessionCleanupPlan,
  options: DeleteChatSessionGraphOptions,
): void => {
  if (options.expectedUpdatedAt && plan.sessionUpdatedAt !== options.expectedUpdatedAt) {
    throw new StaleChatSessionError(
      plan.sessionId,
      `Session ${plan.sessionId} changed after preflight (${options.expectedUpdatedAt} -> ${plan.sessionUpdatedAt})`,
    );
  }
  if (!options.expectedCleanupJobIds) return;
  const planned = plan.jobs.map((job) => job.id).join(",");
  const expected = [...options.expectedCleanupJobIds].join(",");
  if (planned !== expected) {
    throw new StaleChatSessionError(
      plan.sessionId,
      `Session ${plan.sessionId} cleanup plan changed after preflight`,
    );
  }
};

const nowIso = (): string => new Date().toISOString();
