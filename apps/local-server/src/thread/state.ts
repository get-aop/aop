import type { Thread, ThreadStatus } from "@aop/common";
import type { SchedulePhase } from "../chat-session/session-hooks.ts";
import type { ThreadStatusChange } from "./repository.ts";

export type TurnEnd = "completed" | "failed" | "interrupted" | "cancelled" | "rate-limited";

/**
 * Where a thread goes when its agent's turn ends, or null to leave it as it is.
 *
 * - A thread the person resolved, or one whose pull request is landing, is not this turn's to move.
 * - A rate limit refused the turn: the thread waits until `resumesAt`, with any message that was
 *   already queued. A pending question stays as it is, since the person's answer resumes it.
 * - A message is already waiting: the next turn starts at once, so the thread keeps working.
 * - The person stopped it (cancelled, interrupted): idle, and a pending question is void.
 * - A question is pending and the turn completed or failed: it stays waiting on the person.
 * - Otherwise finished work is ready for review once its whole checklist is done, else idle.
 */
export const statusAfterTurn = (
  thread: Pick<Thread, "status" | "steps">,
  end: TurnEnd,
  hasQueuedMessage: boolean,
  resumesAt: string | null = null,
): ThreadStatusChange | null => {
  if (thread.status === "resolved" || thread.status === "landing") return null;
  if (end === "rate-limited") {
    return resumesAt && canWaitOnRateLimit(thread.status)
      ? { status: "rate-limited", resumesAt }
      : null;
  }
  if (hasQueuedMessage) return { status: "working" };
  return statusAfterEndedTurn(thread, end);
};

const statusAfterEndedTurn = (
  thread: Pick<Thread, "status" | "steps">,
  end: TurnEnd,
): ThreadStatusChange | null => {
  if (end === "cancelled" || end === "interrupted") return { status: "idle" };
  if (thread.status === "waiting-on-you") return null;
  if (end === "failed") return { status: "idle" };
  const finished = thread.steps.length > 0 && thread.steps.every((step) => step.state === "done");
  return { status: finished ? "ready-for-review" : "idle" };
};

/** Whether a rate limit that ended a turn can put a thread in this status on hold. */
export const canWaitOnRateLimit = (status: ThreadStatus): boolean =>
  status !== "resolved" && status !== "landing" && status !== "waiting-on-you";

export const QUEUED_STATUS_LINE = "Waiting for a free run slot";

/**
 * How a thread's status follows its turn through the run queue, or null to leave it. A turn that
 * has to wait puts a working thread in the queue; a turn that got its slot, or a rate-limit wait
 * that ended, makes the thread work.
 */
export const statusAfterSchedule = (
  status: ThreadStatus,
  phase: SchedulePhase,
): { status: "queued" | "working"; liveStatusLine: string | null } | null => {
  if (phase === "queued") {
    return status === "working" ? { status: "queued", liveStatusLine: QUEUED_STATUS_LINE } : null;
  }
  return status === "queued" || status === "rate-limited"
    ? { status: "working", liveStatusLine: null }
    : null;
};

/** The one line under a thread's title once its turn is over, when the thread reported none. */
export const closingStatusLine = (end: TurnEnd, finalText: string): string => {
  if (end === "failed") return `Failed: ${firstLine(finalText)}`;
  if (end === "completed" || end === "rate-limited") return firstLine(finalText);
  return "Stopped";
};

const STATUS_LINE_MAX = 200;

const firstLine = (text: string): string => {
  const line = text.split("\n").find((candidate) => candidate.trim()) ?? "";
  const trimmed = line.trim();
  return trimmed.length <= STATUS_LINE_MAX ? trimmed : `${trimmed.slice(0, STATUS_LINE_MAX - 1)}…`;
};
