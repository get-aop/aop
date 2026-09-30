import type { ChatSessionLifecycle } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { pendingSessionReplies } from "./reply-state.ts";
import { sessionRunPhase } from "./runtime-engine.ts";

export const hasRunningChatRun = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<boolean> => {
  const run = await ctx.db
    .selectFrom("chat_runs")
    .select("id")
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .executeTakeFirst();
  return Boolean(run);
};

/**
 * Resolve the session-scoped lifecycle used by list/detail/send/SSE.
 * Current-process ownership beats durable-only recovery for stop/steer accuracy.
 */
export const resolveAssistantLifecycle = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<ChatSessionLifecycle> => {
  const live = liveAssistantLifecycle(sessionId);
  if (live) return live;
  const durableRunning = await hasRunningChatRun(ctx, sessionId);
  return durableRunning ? "uncontrollable" : "idle";
};

export const resolveAssistantLifecycles = async (
  ctx: LocalServerContext,
  sessionIds: string[],
): Promise<Map<string, ChatSessionLifecycle>> => {
  if (sessionIds.length === 0) return new Map();
  const durableRows = await ctx.db
    .selectFrom("chat_runs")
    .select("session_id")
    .where("status", "=", "running")
    .groupBy("session_id")
    .execute();
  const durableRunning = new Set(durableRows.map((row) => row.session_id));
  return new Map(
    sessionIds.map((sessionId) => [
      sessionId,
      assistantLifecycleFromState(sessionId, durableRunning.has(sessionId)),
    ]),
  );
};

const assistantLifecycleFromState = (
  sessionId: string,
  durableRunning: boolean,
): ChatSessionLifecycle => {
  const live = liveAssistantLifecycle(sessionId);
  if (live) return live;
  return durableRunning ? "uncontrollable" : "idle";
};

const liveAssistantLifecycle = (sessionId: string): ChatSessionLifecycle | null => {
  const phase = sessionRunPhase(sessionId);
  if (phase === "cancelling") return "cancelling";
  if (phase === "running" || phase === "spawning") return "running";
  if (phase === "pending" || pendingSessionReplies.has(sessionId)) return "pending";
  return null;
};
