import { getLogger } from "@aop/infra";
import { resolveAssistantLifecycles } from "../chat-session/service.ts";
import { cancelQueuedSteers } from "../chat-session/steer-queue.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import type { ChatEngine } from "./engine.ts";

const logger = getLogger("project", "session-control");

const IDLE_POLL_MS = 25;
const IDLE_TIMEOUT_MS = 15_000;

/**
 * Stops a project session for good: its queued messages are cancelled first (so Stop does not
 * start the next one), then the running turn is aborted, and the call returns once the engine
 * reports the session idle. A session that never settles is logged and left to the engine.
 */
export const stopProjectSession = async (
  ctx: LocalServerContext,
  chat: ChatEngine,
  session: ChatSession,
): Promise<void> => {
  await cancelQueuedSteers(ctx, session.id, session.runtime, "abort");
  await chat.abort(session.id);
  if (!(await waitUntilIdle(ctx, session.id))) {
    logger.warn("Session {sessionId} still running {timeoutMs}ms after Stop", {
      sessionId: session.id,
      timeoutMs: IDLE_TIMEOUT_MS,
    });
  }
};

const waitUntilIdle = async (ctx: LocalServerContext, sessionId: string): Promise<boolean> => {
  const deadline = Date.now() + IDLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const lifecycles = await resolveAssistantLifecycles(ctx, [sessionId]);
    if (lifecycles.get(sessionId) === "idle") return true;
    await Bun.sleep(IDLE_POLL_MS);
  }
  return false;
};
