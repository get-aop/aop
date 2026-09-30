import type { Thread } from "@aop/common";
import type { ThreadStatusChange } from "./repository.ts";

export type TurnEnd = "completed" | "failed" | "interrupted" | "cancelled";

/**
 * Where a thread goes when its agent's turn ends, or null to leave it as it is.
 *
 * - A message is already waiting: the next turn starts at once, so the thread keeps working.
 * - The person stopped it (cancelled, interrupted): idle, and a pending question is void.
 * - A question is pending and the turn completed or failed: it stays waiting on the person.
 * - A thread the person resolved, or one whose pull request is landing, is not this turn's to move.
 * - Otherwise finished work is ready for review once its whole checklist is done, else idle.
 */
export const statusAfterTurn = (
  thread: Pick<Thread, "status" | "steps">,
  end: TurnEnd,
  hasQueuedMessage: boolean,
): ThreadStatusChange | null => {
  if (thread.status === "resolved" || thread.status === "landing") return null;
  if (hasQueuedMessage) return { status: "working" };
  if (end === "cancelled" || end === "interrupted") return { status: "idle" };
  if (thread.status === "waiting-on-you") return null;
  if (end === "failed") return { status: "idle" };
  const finished = thread.steps.length > 0 && thread.steps.every((step) => step.state === "done");
  return { status: finished ? "ready-for-review" : "idle" };
};

/** The one line under a thread's title once its turn is over, when the thread reported none. */
export const closingStatusLine = (end: TurnEnd, finalText: string): string => {
  if (end === "failed") return `Failed: ${firstLine(finalText)}`;
  if (end === "completed") return firstLine(finalText);
  return "Stopped";
};

const STATUS_LINE_MAX = 200;

const firstLine = (text: string): string => {
  const line = text.split("\n").find((candidate) => candidate.trim()) ?? "";
  const trimmed = line.trim();
  return trimmed.length <= STATUS_LINE_MAX ? trimmed : `${trimmed.slice(0, STATUS_LINE_MAX - 1)}…`;
};
