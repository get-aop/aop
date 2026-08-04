import type { Kysely } from "kysely";
import { chunkIds } from "../db/batching.ts";
import type { ChatRevertOperation, ChatRunCheckpoint } from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";

/** Shared chat-history row access for every flow that deletes checkpoint-backed rows. */

export const listRunIdsBySession = async (
  db: Kysely<Database>,
  sessionId: string,
): Promise<string[]> => {
  const rows = await db
    .selectFrom("chat_runs")
    .select("id")
    .where("session_id", "=", sessionId)
    .orderBy("id")
    .execute();
  return rows.map((row) => row.id);
};

export const listCheckpointsByRunIds = async (
  db: Kysely<Database>,
  runIds: readonly string[],
): Promise<ChatRunCheckpoint[]> => {
  const checkpoints: ChatRunCheckpoint[] = [];
  for (const batch of chunkIds(runIds)) {
    checkpoints.push(
      ...(await db
        .selectFrom("chat_run_checkpoints")
        .selectAll()
        .where("run_id", "in", batch)
        .orderBy("run_id")
        .execute()),
    );
  }
  return checkpoints;
};

/** Revert operations whose hidden refs are still the caller's responsibility. */
export const listUnfinishedRevertOperations = (
  db: Kysely<Database>,
  sessionId: string,
): Promise<ChatRevertOperation[]> =>
  db
    .selectFrom("chat_revert_operations")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("cleanup_status", "!=", "completed")
    .orderBy("created_at")
    .orderBy("id")
    .execute();

/** Deletes run-owned children before the runs themselves, chunked for SQLite binds. */
export const deleteRunGraph = async (
  db: Kysely<Database>,
  runIds: readonly string[],
): Promise<void> => {
  for (const batch of chunkIds(runIds)) {
    await db.deleteFrom("chat_run_events").where("run_id", "in", batch).execute();
    await db.deleteFrom("chat_run_changed_files").where("run_id", "in", batch).execute();
    await db.deleteFrom("chat_run_checkpoints").where("run_id", "in", batch).execute();
    await db.deleteFrom("chat_runs").where("id", "in", batch).execute();
  }
};
