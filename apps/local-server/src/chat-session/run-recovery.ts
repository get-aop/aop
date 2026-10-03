import type { TurnPart } from "@aop/common";
import { cuaRunEnded } from "../computer-use/host-gate.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatRun } from "../db/schema.ts";
import { pollForProcessExit } from "../process/liveness.ts";
import { waitForChatRunTerminal } from "./chat-run-recovery.ts";
import { finalizeChatRunAndPublish } from "./finalize-publish.ts";
import { armStoredResumes, pausedReply } from "./rate-limit-resume.ts";
import {
  applyFollowUp,
  dispatchQueuedRuns,
  drainAfterResume,
  drainQueuedSteers,
} from "./reply-lifecycle.ts";
import { pendingSessionReplies, recoveryAbortControllers, recoveryTasks } from "./reply-state.ts";
import { settleRunInput } from "./run-input.ts";
import { isChatRunProcessGone } from "./run-process.ts";
import { isSessionRunActive } from "./runtime-engine.ts";
import type { ChatSessionServiceDeps } from "./session-types.ts";

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
  await armStoredResumes(ctx, drainAfterResume(ctx, deps));
  await drainProjectInboxes(ctx, deps);
};

// A thread's report is a queued message in the coordinator's session, and a thread's turn that
// waited for a run slot is a queued message in its own, so both survive a restart; whatever was
// still waiting when the server stopped is started now. Threads start together, in the order
// they queued, and only as many as the host has room for.
const drainProjectInboxes = async (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  const sessions = await ctx.db
    .selectFrom("chat_sessions")
    .select(["id", "runtime", "kind"])
    .where("project_id", "is not", null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("chat_messages")
          .select("chat_messages.id")
          .whereRef("chat_messages.session_id", "=", "chat_sessions.id")
          .where("chat_messages.role", "=", "user")
          .where("chat_messages.steered_run_id", "is", null)
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
    if (session.kind !== "thread") await drainQueuedSteers(ctx, session.id, session.runtime, deps);
  }
  if (sessions.some((session) => session.kind === "thread")) await dispatchQueuedRuns(ctx, deps);
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
  let parts: TurnPart[] = [];
  let terminal: Awaited<ReturnType<typeof waitForChatRunTerminal>>;
  const session = await ctx.chatSessionRepository.getById(run.session_id);
  const executable = session?.runtime_alias ?? null;
  try {
    terminal = await waitForChatRunTerminal({
      run,
      pollIntervalMs: deps.recoveryPollIntervalMs,
      isProcessGone: () => isChatRunProcessGone(run, executable),
      settleInput: run.input_path ? () => settleRunInput(ctx, run.id) : undefined,
      signal,
      onProgress: (progress) => {
        parts = progress;
        if (session) ctx.sessionHooks.onAssistantProgress(session, run, progress);
      },
    });
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
  if (signal.aborted) return;
  await waitForEndedInputExit(run);
  // A run that outlived a host restart gives back the computer-use lease when it ends, too.
  void cuaRunEnded(run.session_id).catch(() => {});
  // A project's session that a limit refused waits for it, as it does when the server stayed up.
  const recovered = {
    ...terminal,
    ...(await pausedReply(
      ctx.db,
      session ?? { id: run.session_id, project_id: null },
      terminal.text,
      terminal.rateLimit,
    )),
  };
  const followUp = await finalizeChatRunAndPublish(
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
      rateLimit: recovered.rateLimit,
    },
    parts,
  );
  if (signal.aborted) return;
  // Server restart recovery: also drain steers queued while the recovered run was live.
  void drainQueuedSteers(ctx, run.session_id, run.runtime, deps);
  void applyFollowUp(ctx, followUp, deps);
};

/** How long a recovered run whose input ended is given to exit before its turn is finalized. */
const INPUT_EXIT_WAIT_MS = 10_000;

// A run whose input ended exits after its answer. The next turn resumes the same session, so it
// starts once this one has let go of it.
const waitForEndedInputExit = async (run: ChatRun): Promise<void> => {
  if (!run.input_path || run.pid === null) return;
  await Promise.race([pollForProcessExit(run.pid, 100), Bun.sleep(INPUT_EXIT_WAIT_MS)]);
};
