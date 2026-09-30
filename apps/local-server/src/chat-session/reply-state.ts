import type { LocalServerContext } from "../context.ts";

/** In-flight reply work claimed before the provider run starts (closes the accept→run gap). */
export const pendingSessionReplies = new Set<string>();
export const abortRequestedSessions = new Set<string>();
export const backgroundReplyTasks = new Set<Promise<void>>();
export const recoveryTasks = new Map<string, Promise<void>>();
export const recoveryAbortControllers = new Map<string, AbortController>();

export const cancelChatRunRecovery = async (runId: string): Promise<void> => {
  recoveryAbortControllers.get(runId)?.abort();
  const recovery = recoveryTasks.get(runId);
  if (recovery) await recovery;
};

/** Await in-flight background replies and restart recoveries (tests). */
export const waitForPendingChatReplies = async (): Promise<void> => {
  while (backgroundReplyTasks.size > 0 || recoveryTasks.size > 0) {
    await Promise.allSettled([...backgroundReplyTasks, ...recoveryTasks.values()]);
  }
};

export const trackBackgroundReply = (task: Promise<void>): void => {
  backgroundReplyTasks.add(task);
  void task.finally(() => backgroundReplyTasks.delete(task));
};

export const isDbClosedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("destroyed") || message.includes("Database has been closed");
};

export const shouldSkipAssistantReply = async (
  ctx: LocalServerContext,
  sessionId: string,
  runId: string,
): Promise<boolean> => {
  // Abort/reset suppress provider launch. Steer keeps ownership and must settle through
  // runSessionPrompt so interruptionKind stays "steer" rather than a cancelled abort.
  if (abortRequestedSessions.has(sessionId)) return true;
  const run = await ctx.db
    .selectFrom("chat_runs")
    .select("status")
    .where("id", "=", runId)
    .executeTakeFirst();
  return run?.status !== "running";
};
