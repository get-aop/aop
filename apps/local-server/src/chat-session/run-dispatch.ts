import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { countRunningThreadRuns, readRunCap } from "../scheduling/capacity.ts";
import { listQueuedThreadTurns, type QueuedThreadTurn } from "../scheduling/queue.ts";
import { isDbClosedError } from "./reply-state.ts";
import { SessionMutationBlockedError } from "./session-mutation-lock.ts";

const logger = getLogger("chat-session", "run-dispatch");

/** What starting a session's next queued turn came to. */
export type StartOutcome =
  /** The turn has a run and is going. */
  | "started"
  /** The turn could not start, so it was ended as failed: the queue moves on. */
  | "failed"
  /** The host has no free run slot. */
  | "full"
  /** The session cannot take a turn right now (busy, stopped, held); ask again when that changes. */
  | "skipped";

export type StartTurn = (sessionId: string, runtime: string) => Promise<StartOutcome>;

// Passes run one at a time, so two of them never race for the same slot or reorder the queue.
let lastPass: Promise<void> = Promise.resolve();
const shuttingDown = new WeakSet<LocalServerContext>();

/**
 * After this no pass starts a turn for `ctx`. A server that is stopping ends its running turns,
 * and the slots they free must not start the turns still waiting; those wait durably and start
 * when the server does.
 */
export const stopDispatching = (ctx: LocalServerContext): void => {
  shuttingDown.add(ctx);
};

/**
 * Starts queued thread turns while the host has free run slots, oldest first.
 *
 * It is the one place that decides which thread turn runs next, and it decides from stored state
 * every time (the running runs, the messages still waiting, the cap), so it can be called from
 * anywhere and as often as anything changes: a message stored, a run ended, the cap raised, the
 * server started. A call that finds nothing to do does nothing, and one that follows a crash
 * picks up where the crash left the queue.
 *
 * A turn that has to wait puts its thread in the `queued` status; starting it moves the thread
 * on. Coordinator and plain chat turns never come through here: they are never queued.
 */
export const dispatchQueuedThreadTurns = (
  ctx: LocalServerContext,
  start: StartTurn,
): Promise<void> => {
  const pass = lastPass.then(() => runPass(ctx, start));
  // A pass that fails must not stop the passes after it; its own caller still sees the error.
  lastPass = pass.catch(() => undefined);
  return pass;
};

const runPass = async (ctx: LocalServerContext, start: StartTurn): Promise<void> => {
  const cap = await readRunCap(ctx.settingsRepository);
  const skipped = new Set<string>();
  while (!shuttingDown.has(ctx)) {
    const waiting = (await listQueuedThreadTurns(ctx.db)).filter(
      (turn) => !skipped.has(turn.sessionId),
    );
    const next = waiting[0];
    if (!next) return;
    if ((await countRunningThreadRuns(ctx.db)) >= cap) return showQueued(ctx, waiting);

    const outcome = await startIsolated(start, next);
    if (outcome === "full") return showQueued(ctx, waiting);
    if (outcome === "skipped") skipped.add(next.sessionId);
  }
};

// One session that cannot start its turn must not hold up the sessions behind it: whatever goes
// wrong there is logged, and the pass goes on. Only a closing database stops it.
const startIsolated = async (start: StartTurn, turn: QueuedThreadTurn): Promise<StartOutcome> => {
  try {
    return await start(turn.sessionId, turn.runtime);
  } catch (error) {
    if (isDbClosedError(error)) throw error;
    // A session being deleted refuses new work; that is expected and passes.
    if (!(error instanceof SessionMutationBlockedError)) {
      logger.error("Starting the queued turn of {sessionId} failed: {error}", {
        sessionId: turn.sessionId,
        error: String(error),
      });
    }
    return "skipped";
  }
};

const showQueued = async (ctx: LocalServerContext, waiting: QueuedThreadTurn[]): Promise<void> => {
  for (const turn of waiting) {
    if (turn.state === "queued") continue;
    await ctx.eventPublisher.transaction((tx) =>
      ctx.sessionHooks.onTurnScheduled(tx, turn.sessionId, "queued"),
    );
  }
};
