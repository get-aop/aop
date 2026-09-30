import { type MessageDelta, PROJECT_STREAM_EVENTS } from "@aop/common";
import type { SSEStreamHelper } from "../events/sse-stream.ts";
import { mergeDelta } from "./live-turns.ts";
import type { FeedItem } from "./stream-feed.ts";

export interface Outbox {
  /** Live text waits here, one frame per running turn, until `sendDeltas`. */
  queueDelta: (delta: MessageDelta) => void;
  /** Entries and resyncs carry their log id as the SSE id: the cursor a reconnect resumes from. */
  send: (item: FeedItem) => Promise<void>;
  sendDeltas: () => Promise<void>;
  heartbeat: () => Promise<void>;
}

/**
 * What one client is written. Nothing checks whether a write succeeded: after the client
 * leaves the helper turns writes into no-ops, and whoever loops on the outbox stops by
 * asking the helper whether it is cleaned up.
 */
export const createOutbox = (out: SSEStreamHelper): Outbox => {
  const waiting = new Map<string, MessageDelta>();

  const sendEntry = async (item: Extract<FeedItem, { kind: "entry" }>) => {
    const { entry } = item;
    await out.sendEvent(PROJECT_STREAM_EVENTS.entry, entry, entry.id);
    if (entry.type === "message.created") {
      // Live text of a message that now exists is obsolete.
      waiting.delete(entry.payload.message.id);
    } else if (entry.type === "project.removed") {
      // The last thing a project's stream says.
      out.runCleanup();
    }
  };

  return {
    queueDelta: (delta) => {
      waiting.set(delta.messageId, mergeDelta(waiting.get(delta.messageId), delta));
    },

    send: async (item) => {
      if (item.kind === "entry") return sendEntry(item);
      await out.sendEvent(PROJECT_STREAM_EVENTS.resync, item.resync, item.resync.cursor);
    },

    sendDeltas: async () => {
      const batch = [...waiting.values()];
      waiting.clear();
      for (const delta of batch) await out.sendEvent(PROJECT_STREAM_EVENTS.delta, delta, null);
    },

    // No id, so the cursor the browser would resume from is left as it is.
    heartbeat: async () => {
      await out.sendEvent(PROJECT_STREAM_EVENTS.heartbeat, {}, null);
    },
  };
};
