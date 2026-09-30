import type { LocalServerContext } from "../context.ts";
import type { ChatRun } from "../db/schema.ts";
import { finalizeAssistantActivity } from "./assistant-reply.ts";
import { waitForChatRunTerminal } from "./chat-run-recovery.ts";
import { finalizeChatRunAndPublish } from "./finalize-publish.ts";
import { drainQueuedSteers, wakeSessions } from "./reply-lifecycle.ts";
import { pendingSessionReplies, recoveryAbortControllers, recoveryTasks } from "./reply-state.ts";
import { isChatRunProcessGone } from "./run-process.ts";
import { isSessionRunActive } from "./runtime-engine.ts";
import { publishAssistantProgress } from "./session-events.ts";
import type { AssistantActivity, ChatSessionServiceDeps } from "./session-types.ts";

export const ensureAllChatRunRecoveries = async (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  const runs = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("status", "=", "running")
    .execute()
    .catch(() => []);
  for (const run of runs) {
    void startChatRunRecovery(ctx, run, deps);
  }
  await drainProjectInboxes(ctx, deps);
};

// A thread's report is a queued message in the coordinator's session, so it survives a
// restart; whatever was still waiting when the server stopped is started now.
const drainProjectInboxes = async (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  const sessions = await ctx.db
    .selectFrom("chat_sessions")
    .select(["id", "runtime"])
    .where("project_id", "is not", null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("chat_messages")
          .select("chat_messages.id")
          .whereRef("chat_messages.session_id", "=", "chat_sessions.id")
          .where("chat_messages.role", "=", "user")
          .where((unclaimed) =>
            unclaimed.not(
              unclaimed.exists(
                unclaimed
                  .selectFrom("chat_runs")
                  .select("chat_runs.id")
                  .whereRef("chat_runs.user_message_id", "=", "chat_messages.id"),
              ),
            ),
          ),
      ),
    )
    .execute()
    .catch(() => []);
  for (const session of sessions) {
    await drainQueuedSteers(ctx, session.id, session.runtime, deps);
  }
};

export const ensureSessionChatRunRecovery = async (
  ctx: LocalServerContext,
  sessionId: string,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  if (isSessionRunActive(sessionId) || pendingSessionReplies.has(sessionId)) return;
  const run = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .executeTakeFirst();
  if (run) await startChatRunRecovery(ctx, run, deps);
};

const startChatRunRecovery = (
  ctx: LocalServerContext,
  run: ChatRun,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  const existing = recoveryTasks.get(run.id);
  if (existing) return existing;

  const controller = new AbortController();
  recoveryAbortControllers.set(run.id, controller);
  const task = recoverChatRun(ctx, run, deps, controller.signal).finally(() => {
    recoveryTasks.delete(run.id);
    if (recoveryAbortControllers.get(run.id) === controller) {
      recoveryAbortControllers.delete(run.id);
    }
  });
  recoveryTasks.set(run.id, task);
  return task;
};

const recoverChatRun = async (
  ctx: LocalServerContext,
  run: ChatRun,
  deps: ChatSessionServiceDeps,
  signal: AbortSignal,
): Promise<void> => {
  let activity: AssistantActivity | null = null;
  let recovered: Awaited<ReturnType<typeof waitForChatRunTerminal>>;
  const executable =
    (await ctx.chatSessionRepository.getById(run.session_id))?.runtime_alias ?? null;
  try {
    recovered = await waitForChatRunTerminal({
      run,
      pollIntervalMs: deps.recoveryPollIntervalMs,
      isProcessGone: () => isChatRunProcessGone(run, executable),
      signal,
      onProgress: (progress) => {
        activity = progress;
        publishAssistantProgress(run.session_id, progress);
      },
    });
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
  if (signal.aborted) return;
  const wakeSessionIds = await finalizeChatRunAndPublish(
    ctx,
    run,
    recovered.text,
    null,
    recovered.runtimeSessionId,
    {
      status: recovered.status,
      errorMessage: recovered.status === "failed" ? recovered.text : null,
      failureKind: recovered.failureKind ?? null,
      runtimeSessionState: recovered.runtimeSessionState,
    },
    // Same stacking merge as the normal reply path so recovered activity keeps history.
    finalizeAssistantActivity(activity, {
      text: recovered.text,
      failed: recovered.status === "failed",
    }),
  );
  if (signal.aborted) return;
  // Server restart recovery: also drain steers queued while the recovered run was live.
  void drainQueuedSteers(ctx, run.session_id, run.runtime, deps);
  void wakeSessions(ctx, wakeSessionIds, deps);
};
