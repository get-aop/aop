import type { Kysely } from "kysely";
import { sql } from "kysely";
import { chunkIds, chunkRows } from "../db/batching.ts";
import type {
  ChatCheckpointCleanupJob,
  NewChatCheckpointCleanupJob,
} from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";

export interface ChatCheckpointCleanupClaimInput {
  /** Lease identifier proving which worker owns the claimed jobs. */
  token: string;
  now: string;
  /** `processing` claims at or before this timestamp are treated as abandoned. */
  staleBefore: string;
  limit?: number;
  /** Restricts the claim to a known job set (destructive flows own their jobs). */
  ids?: readonly string[];
}

export interface ChatCheckpointCleanupRepository {
  create: (job: NewChatCheckpointCleanupJob) => Promise<ChatCheckpointCleanupJob>;
  createMany: (jobs: NewChatCheckpointCleanupJob[]) => Promise<ChatCheckpointCleanupJob[]>;
  listUnfinished: () => Promise<ChatCheckpointCleanupJob[]>;
  listByIds: (ids: readonly string[]) => Promise<ChatCheckpointCleanupJob[]>;
  claim: (input: ChatCheckpointCleanupClaimInput) => Promise<ChatCheckpointCleanupJob[]>;
  markCompleted: (id: string, token: string, completedAt: string) => Promise<boolean>;
  markFailed: (
    id: string,
    token: string,
    errorMessage: string,
    updatedAt: string,
  ) => Promise<boolean>;
}

const DEFAULT_CLAIM_LIMIT = 100;

export const createChatCheckpointCleanupRepository = (
  db: Kysely<Database>,
): ChatCheckpointCleanupRepository => ({
  create: async (job) => {
    await insertChatCheckpointCleanupJobs(db, [job]);
    return db
      .selectFrom("chat_checkpoint_cleanup_jobs")
      .selectAll()
      .where("id", "=", job.id)
      .executeTakeFirstOrThrow();
  },

  createMany: async (jobs) => {
    await insertChatCheckpointCleanupJobs(db, jobs);
    return listByIds(
      db,
      jobs.map((job) => job.id),
    );
  },

  listUnfinished: () =>
    db
      .selectFrom("chat_checkpoint_cleanup_jobs")
      .selectAll()
      .where("status", "in", ["pending", "failed", "processing"])
      .orderBy("created_at")
      .orderBy("id")
      .execute(),

  listByIds: (ids) => listByIds(db, ids),

  claim: (input) => claimJobs(db, input),

  markCompleted: (id, token, completedAt) =>
    transition(db, id, token, {
      status: "completed",
      error_message: null,
      completed_at: completedAt,
      updated_at: completedAt,
      claim_token: null,
      claimed_at: null,
    }),

  markFailed: (id, token, errorMessage, updatedAt) =>
    transition(db, id, token, {
      status: "failed",
      error_message: errorMessage.slice(0, 500),
      // A retried job must never keep the completion timestamp of an earlier attempt.
      completed_at: null,
      updated_at: updatedAt,
      claim_token: null,
      claimed_at: null,
    }),
});

/**
 * Idempotent by construction: cleanup job ids are content-addressed, so
 * re-planning the same deletion reuses the existing row instead of stacking
 * duplicate pending work. Safe to call inside a caller-owned transaction.
 */
export const insertChatCheckpointCleanupJobs = async (
  db: Kysely<Database>,
  jobs: readonly NewChatCheckpointCleanupJob[],
): Promise<void> => {
  for (const batch of chunkRows(jobs)) {
    await db
      .insertInto("chat_checkpoint_cleanup_jobs")
      .values(batch)
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
  }
};

/**
 * Single guarded UPDATE so two workers racing for the same job cannot both win:
 * whoever writes first flips the row out of the claimable set.
 */
const claimJobs = async (
  db: Kysely<Database>,
  input: ChatCheckpointCleanupClaimInput,
): Promise<ChatCheckpointCleanupJob[]> => {
  if (input.ids?.length === 0) return [];

  await db
    .updateTable("chat_checkpoint_cleanup_jobs")
    .set({
      status: "processing",
      claim_token: input.token,
      claimed_at: input.now,
      updated_at: input.now,
      completed_at: null,
      attempts: sql<number>`attempts + 1`,
    })
    .where("id", "in", (eb) => {
      const ids = input.ids;
      let candidates = eb
        .selectFrom("chat_checkpoint_cleanup_jobs")
        .select("id")
        .where((where) =>
          where.or([
            where("status", "in", ["pending", "failed"]),
            where.and([
              where("status", "=", "processing"),
              where.or([
                where("claimed_at", "is", null),
                where("claimed_at", "<=", input.staleBefore),
              ]),
            ]),
          ]),
        );
      if (ids) candidates = candidates.where("id", "in", [...ids]);
      return candidates
        .orderBy("created_at")
        .orderBy("id")
        .limit(input.limit ?? DEFAULT_CLAIM_LIMIT);
    })
    .execute();

  return db
    .selectFrom("chat_checkpoint_cleanup_jobs")
    .selectAll()
    .where("claim_token", "=", input.token)
    .where("status", "=", "processing")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
};

const transition = async (
  db: Kysely<Database>,
  id: string,
  token: string,
  patch: {
    status: "completed" | "failed";
    error_message: string | null;
    completed_at: string | null;
    updated_at: string;
    claim_token: null;
    claimed_at: null;
  },
): Promise<boolean> => {
  const result = await db
    .updateTable("chat_checkpoint_cleanup_jobs")
    .set(patch)
    .where("id", "=", id)
    .where("status", "=", "processing")
    .where("claim_token", "=", token)
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0) === 1;
};

const listByIds = async (
  db: Kysely<Database>,
  ids: readonly string[],
): Promise<ChatCheckpointCleanupJob[]> => {
  const rows: ChatCheckpointCleanupJob[] = [];
  for (const batch of chunkIds(ids)) {
    rows.push(
      ...(await db
        .selectFrom("chat_checkpoint_cleanup_jobs")
        .selectAll()
        .where("id", "in", batch)
        .orderBy("created_at")
        .orderBy("id")
        .execute()),
    );
  }
  return rows;
};
