import { z } from "zod";
import { TOOL_DETAIL_MAX_LENGTH, TurnPartSchema } from "./blocks.ts";
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
  /** What changed in the assistant turn being written (`MessageDelta`). Not stored, not replayed. */
  delta: "delta",
  /**
   * Every turn of the project being written as the connection opens (`LiveSnapshot`), sent once
   * per connection after the replay. A client drops the live text of any other turn it holds.
   */
  live: "live",
  /** The client cannot be caught up from the log: refetch everything, resume from the cursor (`Resync`). */
  resync: "resync",
  /** Proof the connection is alive; `{}`. */
  heartbeat: "heartbeat",
} as const;

const PartIndexSchema = z.number().int().nonnegative();

/**
 * One change to a turn being written, whose parts (`TurnPart`: prose, tool calls, reasoning)
 * a client holds in order:
 * - reset: the turn so far, replacing what is held. How a client that connects mid-turn gets its
 *   baseline, and how a turn whose parts changed in place is sent again.
 * - start: a new part, at the end (`index` is where it goes, the number of parts held before it).
 * - append: text added to the prose or reasoning at `index`.
 * - tool: the tool call at `index` changed: it finished, failed, or says more about what it does.
 * - end: the turn ended without a message (stopped, say): its live parts go.
 */
export const LiveOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reset"), parts: z.array(TurnPartSchema) }),
  z.object({ op: z.literal("start"), index: PartIndexSchema, part: TurnPartSchema }),
  z.object({ op: z.literal("append"), index: PartIndexSchema, text: z.string().min(1) }),
  z.object({
    op: z.literal("tool"),
    index: PartIndexSchema,
    status: z.enum(["running", "done", "failed"]),
    detail: z.string().max(TOOL_DETAIL_MAX_LENGTH).nullable(),
  }),
  z.object({ op: z.literal("end") }),
]);
export type LiveOp = z.infer<typeof LiveOpSchema>;

/**
 * Live progress of one assistant turn, so a reply shows as it is written. It is keyed by the
 * id the finished reply will have: a client shows the live parts of every `messageId` it does
 * not yet hold as a created message, and drops them when the `message.created` entry with that
 * id arrives. Deltas and entries travel on separate paths, so they can reach a client in
 * either order; this rule makes the order not matter.
 */
export const MessageDeltaSchema = z.object({
  projectId: IdSchema,
  /** The conversation the turn belongs to: a thread's id, or null for the coordinator chat. */
  threadId: IdSchema.nullable(),
  /** The `id` of the assistant message this turn will become. */
  messageId: IdSchema,
  /** The message the turn answers, which is where its reply will sit (`AssistantMessage.inReplyTo`). */
  inReplyTo: IdSchema.optional(),
  /** What changed since the previous delta of this turn, applied in order. */
  ops: z.array(LiveOpSchema).min(1),
});
export type MessageDelta = z.infer<typeof MessageDeltaSchema>;

/**
 * The turns of a project being written when a connection opened, each as a delta to apply to
 * what the client holds (a baseline replaces it). A turn the client holds that is not here ended
 * while it could not hear: its message, if it has one, was in the replay before this frame.
 */
export const LiveSnapshotSchema = z.object({ turns: z.array(MessageDeltaSchema) });
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;

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
