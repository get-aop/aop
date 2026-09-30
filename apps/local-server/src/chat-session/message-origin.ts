import { ThreadReportOutcomeSchema } from "@aop/common";
import { z } from "zod";

/**
 * Who wrote a message that a person did not type. It is stored in `chat_messages.origin_json`
 * and read back by the wire mapping (project/wire-messages.ts), so a new kind is one more
 * variant here and no migration.
 */
export const MessageOriginSchema = z.discriminatedUnion("type", [
  /** The coordinator's brief to a thread; `quote` is the person's own words it forwards, if any. */
  z.object({ type: z.literal("coordinator-relay"), quote: z.string().min(1).nullable() }),
  /** A thread telling the coordinator how a turn ended; it wakes the coordinator. */
  z.object({
    type: z.literal("thread-report"),
    threadId: z.string().min(1),
    outcome: ThreadReportOutcomeSchema,
  }),
]);
export type MessageOrigin = z.infer<typeof MessageOriginSchema>;

export const serializeMessageOrigin = (origin: MessageOrigin): string =>
  JSON.stringify(MessageOriginSchema.parse(origin));

/** A stored origin is checked on every read, so a corrupt row fails loudly. */
export const parseMessageOrigin = (raw: string | null): MessageOrigin | null =>
  raw === null ? null : MessageOriginSchema.parse(JSON.parse(raw));
