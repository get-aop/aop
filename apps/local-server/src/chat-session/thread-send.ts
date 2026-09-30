import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import type { RuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { resolveCurrentSessionRuntimeConfiguration } from "./prepare-send.ts";
import { drainQueuedSteers } from "./reply-lifecycle.ts";
import { sessionDtoFor, toMessageDto } from "./session-dto.ts";
import type {
  ChatSessionServiceDeps,
  SendChatMessageInput,
  SendChatMessageResult,
} from "./session-types.ts";
import { storeSteerUserMessage } from "./steer-queue.ts";

/**
 * A message to a thread. Every thread turn waits for a run slot in the same line, so the message
 * is stored as a queued turn first, which is durable, and the dispatcher starts it as soon as the
 * host has room: at once when it has. Whether the turn is running or still queued is the
 * thread's status, not this result.
 */
export const acceptThreadMessage = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  session: ChatSession,
  input: SendChatMessageInput,
  deps: ChatSessionServiceDeps,
): Promise<SendChatMessageResult> => {
  const resolved = await resolveCurrentSessionRuntimeConfiguration(
    ctx,
    runtimeConfigurations,
    session,
  );
  if (!resolved.success) return resolved;

  const stored = await storeSteerUserMessage(ctx, session.id, { ...input, action: null }, "queued");
  if (!stored.success) return stored;

  await drainQueuedSteers(ctx, session.id, stored.session.runtime, deps);
  return {
    success: true,
    message: toMessageDto(stored.userMessage),
    session: await sessionDtoFor(
      ctx,
      stored.session,
      stored.displayText || "(image attachment)",
      stored.userMessage.created_at,
    ),
  };
};
