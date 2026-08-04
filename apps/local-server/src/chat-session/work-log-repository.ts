import type { Kysely } from "kysely";
import { chunkIds, chunkRows } from "../db/batching.ts";
import type { ChatRunEvent, NewChatRunEvent } from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";

export interface ChatWorkLogRepository {
  insertMany: (events: NewChatRunEvent[]) => Promise<void>;
  listByRunId: (runId: string) => Promise<ChatRunEvent[]>;
  countByRunIds: (runIds: string[]) => Promise<Map<string, number>>;
  deleteByRunIds: (runIds: string[]) => Promise<void>;
}

export const createChatWorkLogRepository = (db: Kysely<Database>): ChatWorkLogRepository => ({
  insertMany: async (events) => {
    for (const batch of chunkRows(events)) {
      await db
        .insertInto("chat_run_events")
        .values(batch)
        .onConflict((oc) =>
          oc.columns(["run_id", "source_kind", "source_index", "source_subindex"]).doNothing(),
        )
        .execute();
    }
  },

  listByRunId: (runId) =>
    db
      .selectFrom("chat_run_events")
      .selectAll()
      .where("run_id", "=", runId)
      .orderBy("sequence")
      .orderBy("source_index")
      .orderBy("source_subindex")
      .orderBy("id")
      .execute(),

  countByRunIds: async (runIds) => {
    const counts = new Map<string, number>();
    for (const batch of chunkIds(runIds)) {
      const rows = await db
        .selectFrom("chat_run_events")
        .select(["run_id", (eb) => eb.fn.countAll<number>().as("count")])
        .where("run_id", "in", batch)
        .groupBy("run_id")
        .execute();
      for (const row of rows) counts.set(row.run_id, Number(row.count));
    }
    return counts;
  },

  deleteByRunIds: async (runIds) => {
    for (const batch of chunkIds(runIds)) {
      await db.deleteFrom("chat_run_events").where("run_id", "in", batch).execute();
    }
  },
});
