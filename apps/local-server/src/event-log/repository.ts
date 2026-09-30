import { type EventLogEntry, EventLogEntrySchema } from "@aop/common";
import type { Kysely } from "kysely";
import type { EventLogRow } from "../db/projects-schema.ts";
import type { Database } from "../db/schema.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An entry before the database assigns its id. */
export type NewEventLogEntry = DistributiveOmit<EventLogEntry, "id">;

export const DEFAULT_EVENT_PAGE_SIZE = 500;

export interface EventLogRepository {
  /**
   * Stores the entry and returns it with its id. Give it the transaction that changes the
   * state the entry describes, so the entry exists exactly when the change does.
   */
  append: (entry: NewEventLogEntry) => Promise<EventLogEntry>;
  /** A project's entries with an id above `afterId`, oldest first: what a client resumes from. */
  listAfter: (projectId: string, afterId: number, limit?: number) => Promise<EventLogEntry[]>;
}

export const createEventLogRepository = (db: Kysely<Database>): EventLogRepository => ({
  append: async (entry) => {
    // The same check a reader applies, so an entry that could not be read back is never
    // stored. It also requires the payload to belong to `projectId`. The database assigns
    // the id; the schema needs one to check the rest of the entry.
    const checked = EventLogEntrySchema.parse({ ...entry, id: 1 });
    const { id } = await db
      .insertInto("event_log")
      .values({
        project_id: checked.projectId,
        type: checked.type,
        payload: JSON.stringify(checked.payload),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { ...checked, id };
  },

  listAfter: async (projectId, afterId, limit = DEFAULT_EVENT_PAGE_SIZE) => {
    const rows = await db
      .selectFrom("event_log")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("id", ">", afterId)
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.map(toEntry);
  },
});

const toEntry = (row: EventLogRow): EventLogEntry =>
  EventLogEntrySchema.parse({
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    payload: JSON.parse(row.payload),
  });
