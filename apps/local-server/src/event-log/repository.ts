import { type EventLogEntry, EventLogEntrySchema } from "@aop/common";
import { type Kysely, sql } from "kysely";
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
  /** How many of a project's entries lie after `afterId`: the size of the backlog a resume would replay. */
  countAfter: (projectId: string, afterId: number) => Promise<number>;
  /** A project's newest entry of one type after `afterId`, or null. */
  findLatest: (
    projectId: string,
    type: EventLogEntry["type"],
    afterId: number,
  ) => Promise<EventLogEntry | null>;
  /**
   * The newest id ever assigned, even when its entry was trimmed since; 0 before the first
   * entry. A cursor above it came from another database.
   */
  latestId: () => Promise<number>;
  /**
   * Where trimming has reached: entries with an id up to this may have been deleted, so a
   * cursor below it may have missed some, and a cursor at or above it has missed none. It is
   * 0 while nothing was trimmed, and the newest id ever assigned when nothing is left.
   */
  trimFloor: () => Promise<number>;
  /**
   * Deletes every entry but the newest `keep`, of whichever project. It only ever removes the
   * oldest prefix of the log, and ids are never reused, so `trimFloor` says exactly which
   * cursors are still complete.
   */
  trimToNewest: (keep: number) => Promise<void>;
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

  countAfter: async (projectId, afterId) => {
    const row = await db
      .selectFrom("event_log")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("project_id", "=", projectId)
      .where("id", ">", afterId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  },

  findLatest: async (projectId, type, afterId) => {
    const row = await db
      .selectFrom("event_log")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("type", "=", type)
      .where("id", ">", afterId)
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
    return row ? toEntry(row) : null;
  },

  // sqlite_sequence is what AUTOINCREMENT keeps: unlike max(id), it survives trimming.
  latestId: async () => {
    const { rows } = await sql<{
      seq: number;
    }>`SELECT seq FROM sqlite_sequence WHERE name = 'event_log'`.execute(db);
    return rows[0]?.seq ?? 0;
  },

  // Ids are contiguous until something is trimmed, so the oldest stored id names the floor.
  trimFloor: async () => {
    const { rows } = await sql<{ floor: number }>`
      SELECT COALESCE(
        (SELECT MIN(id) FROM event_log) - 1,
        (SELECT seq FROM sqlite_sequence WHERE name = 'event_log'),
        0
      ) AS floor`.execute(db);
    return rows[0]?.floor ?? 0;
  },

  trimToNewest: async (keep) => {
    if (!Number.isInteger(keep) || keep < 0) throw new RangeError(`Cannot keep ${keep} entries`);
    // The id of the newest entry to delete; no such row means the log is already short enough.
    await db
      .deleteFrom("event_log")
      .where("id", "<=", (eb) =>
        eb.selectFrom("event_log").select("id").orderBy("id", "desc").limit(1).offset(keep),
      )
      .execute();
  },
});

const toEntry = (row: EventLogRow): EventLogEntry =>
  EventLogEntrySchema.parse({
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    payload: JSON.parse(row.payload),
  });
