import { type Kysely, sql } from "kysely";
import type { Database } from "../db/schema.ts";
import {
  claim,
  confirm,
  reconcile,
  release,
  unsettled,
  WatchEntriesSchema,
  type WatchEntry,
} from "./ledger.ts";

/** A thread whose pull request is open, in a project that is running, and not being merged by a person. */
export interface WatchedThread {
  threadId: string;
  repoId: string;
}

/**
 * The watcher's stored memory of a thread's pull request (see ledger.ts) and the list of what
 * there is to watch. Every change reads and writes the entries in one transaction, or in the
 * caller's when the repository was made from one, so it commits with the message it belongs to.
 */
export interface WatchRepository {
  entries: (threadId: string) => Promise<WatchEntry[]>;
  /** Writes the fix down as an attempt. False when the cap is reached or an occurrence in it is already answered. */
  claimFix: (threadId: string, fix: WatchEntry, maxAttempts: number) => Promise<boolean>;
  confirmFix: (threadId: string, id: string) => Promise<void>;
  releaseFix: (threadId: string, id: string) => Promise<void>;
  /** Adds a report to what is remembered. */
  record: (threadId: string, entry: WatchEntry) => Promise<void>;
  /** Settles fixes a crash left half sent, by whether the thread has each one's message. */
  reconcileFixes: (threadId: string) => Promise<void>;
  listOpen: () => Promise<WatchedThread[]>;
}

export const createWatchRepository = (db: Kysely<Database>): WatchRepository => {
  const change = (
    threadId: string,
    edit: (entries: WatchEntry[]) => WatchEntry[] | null,
  ): Promise<boolean> =>
    atomically(db, async (trx) => {
      const edited = edit(await readEntries(trx, threadId));
      if (!edited) return false;
      await writeEntries(trx, threadId, edited);
      return true;
    });

  return {
    entries: (threadId) => readEntries(db, threadId),

    claimFix: (threadId, fix, maxAttempts) =>
      change(threadId, (entries) => claim(entries, fix, maxAttempts)),

    confirmFix: async (threadId, id) => {
      await change(threadId, (entries) => confirm(entries, id));
    },

    releaseFix: async (threadId, id) => {
      await change(threadId, (entries) => release(entries, id));
    },

    record: async (threadId, entry) => {
      await change(threadId, (entries) => [...entries, entry]);
    },

    reconcileFixes: async (threadId) => {
      const waiting = unsettled(await readEntries(db, threadId));
      if (waiting.length === 0) return;
      const sent = new Set<string>();
      for (const { id } of waiting) {
        if (await hasClaimedMessage(db, threadId, id)) sent.add(id);
      }
      await change(threadId, (entries) => reconcile(entries, (id) => sent.has(id)));
    },

    listOpen: async () => {
      const rows = await db
        .selectFrom("chat_sessions")
        .innerJoin("projects", "projects.id", "chat_sessions.project_id")
        .select(["chat_sessions.id as threadId", "chat_sessions.repo_id as repoId"])
        .where("chat_sessions.kind", "=", "thread")
        .where("chat_sessions.pr_state", "=", "open")
        .where("chat_sessions.state", "is not", "landing")
        .where("projects.status", "=", "active")
        .orderBy("chat_sessions.id")
        .execute();
      return rows.flatMap(({ threadId, repoId }) => (repoId ? [{ threadId, repoId }] : []));
    },
  };
};

const readEntries = async (db: Kysely<Database>, threadId: string): Promise<WatchEntry[]> => {
  const row = await db
    .selectFrom("pull_request_watch")
    .select("entries_json")
    .where("thread_id", "=", threadId)
    .executeTakeFirst();
  return row ? WatchEntriesSchema.parse(JSON.parse(row.entries_json)) : [];
};

const writeEntries = async (
  db: Kysely<Database>,
  threadId: string,
  entries: readonly WatchEntry[],
): Promise<void> => {
  const entries_json = JSON.stringify(entries);
  await db
    .insertInto("pull_request_watch")
    .values({ thread_id: threadId, entries_json })
    .onConflict((conflict) =>
      conflict.column("thread_id").doUpdateSet({
        entries_json,
        updated_at: sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      }),
    )
    .execute();
};

/** Whether the session holds the message a fix was sent as: the message names its fix in its origin. */
const hasClaimedMessage = async (
  db: Kysely<Database>,
  sessionId: string,
  claimId: string,
): Promise<boolean> => {
  const row = await db
    .selectFrom("chat_messages")
    .select("id")
    .where("session_id", "=", sessionId)
    .where(sql<string>`json_extract(origin_json, '$.claimId')`, "=", claimId)
    .executeTakeFirst();
  return row !== undefined;
};

// Multi-statement changes join the caller's transaction when there is one.
const atomically = <T>(
  db: Kysely<Database>,
  run: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> => (db.isTransaction ? run(db) : db.transaction().execute(run));
