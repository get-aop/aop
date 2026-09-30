import type { EventLogEntry, Resync, ResyncReason } from "@aop/common";
import { getLogger } from "@aop/infra";
import { ZodError } from "zod";
import type { EventLogRepository } from "./repository.ts";

const logger = getLogger("event-stream");

/** A client further behind than this many entries is told to resync instead of replayed to. */
export const MAX_REPLAY_ENTRIES = 1_000;
export const PAGE_SIZE = 200;

export type FeedItem = { kind: "resync"; resync: Resync } | { kind: "entry"; entry: EventLogEntry };

export interface LogFeed {
  /** The opening item: a resync when the client's cursor cannot be served from the log. */
  open: () => Promise<FeedItem[]>;
  /**
   * The next page after the cursor, or the resync a cursor deserves when trimming has got past
   * it. `more` says to read again: the page was full, or a resync moved the cursor.
   */
  next: () => Promise<{ items: FeedItem[]; more: boolean }>;
}

/** One project's log, read in pages after a cursor that moves forward as items are returned. */
export const createLogFeed = (
  log: EventLogRepository,
  projectId: string,
  after: number | null,
): LogFeed => {
  let cursor = after ?? 0;

  const resync = async (reason: ResyncReason): Promise<FeedItem> => {
    cursor = await log.latestId();
    return { kind: "resync", resync: { cursor, reason } };
  };

  const openingReason = async (): Promise<ResyncReason | null> => {
    if (after === null) return "start";
    if (after > (await log.latestId())) return "ahead";
    const backlog = await log.countAfter(projectId, after);
    return backlog > MAX_REPLAY_ENTRIES ? "too-large" : null;
  };

  // An entry stored under an older schema cannot be replayed. Resyncing past it lets a client
  // whose cursor is before it recover, where failing would make it retry forever.
  const readPage = async (): Promise<EventLogEntry[] | null> => {
    try {
      return await log.listAfter(projectId, cursor, PAGE_SIZE);
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      logger.warn("An entry of project {projectId} after {cursor} cannot be read: {error}", {
        projectId,
        cursor,
        error: error.message,
      });
      return null;
    }
  };

  return {
    open: async () => {
      const reason = await openingReason();
      return reason ? [await resync(reason)] : [];
    },

    next: async () => {
      const page = await readPage();
      if (page === null) return { items: [await resync("unreadable")], more: true };
      // Checked after reading: trimming only removes from the front, so if nothing after the
      // cursor was gone by now, the page just read missed nothing.
      if (cursor < (await log.trimFloor())) return { items: [await resync("trimmed")], more: true };
      cursor = page.at(-1)?.id ?? cursor;
      return {
        items: page.map((entry): FeedItem => ({ kind: "entry", entry })),
        more: page.length === PAGE_SIZE,
      };
    },
  };
};
