import { z } from "zod";
import { IdSchema } from "./primitives.ts";

/**
 * The SSE event names of a project stream. The `data` of every one is JSON.
 *
 * Only `entry` and `resync` carry an SSE `id`, and it is always an event-log id, so the
 * browser's own `Last-Event-ID` (and a client's `?after=`) can only ever hold a cursor
 * the log understands. `delta` and `heartbeat` carry none and leave the cursor alone.
 */
export const PROJECT_STREAM_EVENTS = {
  /** One durable, replayable `EventLogEntry`; its SSE `id` is the entry's id. */
  entry: "entry",
  /** Live text of the assistant turn being written (`MessageDelta`). Not stored, not replayed. */
  delta: "delta",
  /** The client cannot be caught up from the log: refetch everything, resume from the cursor (`Resync`). */
  resync: "resync",
  /** Proof the connection is alive; `{}`. */
  heartbeat: "heartbeat",
} as const;

/**
 * Live progress of one assistant turn, so a reply shows as it is written. It is keyed by the
 * id the finished reply will have: a client shows the live text of every `messageId` it does
 * not yet hold as a created message, and drops it when the `message.created` entry with that
 * id arrives. Deltas and entries travel on separate paths, so they can reach a client in
 * either order; this rule makes the order not matter.
 */
export const MessageDeltaSchema = z.object({
  projectId: IdSchema,
  /** The conversation the turn belongs to: a thread's id, or null for the coordinator chat. */
  threadId: IdSchema.nullable(),
  /** The `id` of the assistant message this turn will become. */
  messageId: IdSchema,
  /** Text appended since the previous delta of this turn; the whole text so far when `replace`. */
  text: z.string(),
  /**
   * The text replaces what the client accumulated instead of extending it. It is how a client
   * that connects mid-turn gets its baseline, and an empty replacement drops the turn's live
   * text (it ended without a message, for example because the user stopped it).
   */
  replace: z.boolean(),
});
export type MessageDelta = z.infer<typeof MessageDeltaSchema>;

/**
 * Why the client's cursor could not be served from the log:
 * - start: the client has no cursor yet.
 * - trimmed: entries after the cursor were trimmed away.
 * - ahead: the cursor is newer than any entry, as after a restored or replaced database.
 * - too-large: the backlog after the cursor is more than a stream replays.
 * - unreadable: an entry after the cursor no longer matches the schema, as when an upgrade
 *   changed a type the log recorded, so the log cannot be replayed past it.
 */
export const ResyncReasonSchema = z.enum(["start", "trimmed", "ahead", "too-large", "unreadable"]);

/**
 * Tells a client to refetch the project, its threads and its messages, then keep listening.
 * Everything the log recorded up to `cursor` is in what it will fetch, and the entries that
 * follow arrive on the stream, so the fetch must start after this event.
 */
export const ResyncSchema = z.object({
  cursor: z.number().int().nonnegative(),
  reason: ResyncReasonSchema,
});
export type Resync = z.infer<typeof ResyncSchema>;
export type ResyncReason = z.infer<typeof ResyncReasonSchema>;
