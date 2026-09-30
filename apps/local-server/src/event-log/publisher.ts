import type { EventLogEntry, MessageDelta } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createLiveTurns } from "./live-turns.ts";
import { createEventLogRepository, type NewEventLogEntry } from "./repository.ts";

const logger = getLogger("event-log");

/**
 * How many entries the log keeps. Older ones are trimmed, and a client whose cursor points
 * into the trimmed part resyncs instead of replaying.
 */
export const DEFAULT_MAX_LOG_ENTRIES = 10_000;
/** The log is trimmed whenever an appended id is a multiple of this, so it holds at most that much over its limit. */
export const DEFAULT_TRIM_EVERY = 1_000;

export interface EventPublisherOptions {
  maxEntries?: number;
  trimEvery?: number;
}

/** What an open stream hears about its project. */
export interface ProjectListener {
  /** Entries were committed for the project. They are in the log; read them from there. */
  onCommit: () => void;
  /** Live text of a running turn, in order. */
  onDelta: (delta: MessageDelta) => void;
}

export interface ProjectSubscription {
  unsubscribe: () => void;
  /** The turns running when the subscription was made, so later deltas have a baseline to append to. */
  runningTurns: MessageDelta[];
}

export interface PublisherTransaction {
  /** The open transaction. Give it to repositories, so their writes commit together with the entries. */
  db: Kysely<Database>;
  append: (entry: NewEventLogEntry) => Promise<EventLogEntry>;
}

/**
 * The one way domains tell clients that something changed: append to the project's event
 * log, which open streams deliver and a reconnecting client resumes from.
 */
export interface EventPublisher {
  /** Stores one entry and delivers it to the project's open streams. */
  publish: (entry: NewEventLogEntry) => Promise<EventLogEntry>;
  /**
   * Runs `work` in one database transaction. The entries it appends are stored together with
   * its other writes, and open streams hear of them only after the commit; if `work` throws,
   * neither the writes nor the entries exist. Use `tx.db`, not the shared database, inside:
   * the connection is busy until the transaction ends.
   */
  transaction: <T>(work: (tx: PublisherTransaction) => Promise<T>) => Promise<T>;
  /** Live text of a turn being written. Not stored: a client that misses it gets the baseline on connecting. */
  publishLive: (delta: MessageDelta) => void;
  /** Ends a turn that will not produce its message (stopped, failed), so clients drop its live text. */
  clearLive: (projectId: string, threadId: string | null, messageId: string) => void;
  /** For open streams. */
  subscribe: (projectId: string, listener: ProjectListener) => ProjectSubscription;
}

export const createEventPublisher = (
  db: Kysely<Database>,
  options: EventPublisherOptions = {},
): EventPublisher => {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_LOG_ENTRIES;
  const trimEvery = options.trimEvery ?? DEFAULT_TRIM_EVERY;
  const listeners = new Map<string, Set<ProjectListener>>();
  const liveTurns = createLiveTurns();

  const tell = (projectId: string, message: (listener: ProjectListener) => void) => {
    for (const listener of listeners.get(projectId) ?? []) {
      try {
        message(listener);
      } catch (error) {
        // The state change is committed; one broken stream must not fail its writer or the others.
        logger.error("A stream listener of project {projectId} failed: {error}", {
          projectId,
          error: String(error),
        });
      }
    }
  };

  // Runs after the commit, in the order the entries were appended.
  const committed = async (entries: EventLogEntry[]) => {
    for (const entry of entries) liveTurns.settle(entry);
    for (const projectId of new Set(entries.map((entry) => entry.projectId))) {
      tell(projectId, (listener) => listener.onCommit());
    }
    if (entries.some((entry) => entry.id % trimEvery === 0)) await trim();
  };

  const trim = async () => {
    try {
      await createEventLogRepository(db).trimToNewest(maxEntries);
    } catch (error) {
      // Trimming is housekeeping; it runs again at the next multiple.
      logger.error("Trimming the event log failed: {error}", { error: String(error) });
    }
  };

  const publishLive = (delta: MessageDelta) => {
    liveTurns.apply(delta);
    tell(delta.projectId, (listener) => listener.onDelta(delta));
  };

  return {
    publish: async (entry) => {
      const stored = await createEventLogRepository(db).append(entry);
      await committed([stored]);
      return stored;
    },

    transaction: async (work) => {
      const appended: EventLogEntry[] = [];
      const result = await db.transaction().execute((trx) => {
        const log = createEventLogRepository(trx);
        return work({
          db: trx,
          append: async (entry) => {
            const stored = await log.append(entry);
            appended.push(stored);
            return stored;
          },
        });
      });
      await committed(appended);
      return result;
    },

    publishLive,

    clearLive: (projectId, threadId, messageId) =>
      publishLive({ projectId, threadId, messageId, text: "", replace: true }),

    subscribe: (projectId, listener) => {
      const forProject = listeners.get(projectId) ?? new Set<ProjectListener>();
      forProject.add(listener);
      listeners.set(projectId, forProject);
      return {
        unsubscribe: () => {
          forProject.delete(listener);
          if (forProject.size === 0 && listeners.get(projectId) === forProject) {
            listeners.delete(projectId);
          }
        },
        runningTurns: liveTurns.list(projectId),
      };
    },
  };
};
