import type { Thread, ThreadReportOutcome } from "@aop/common";
import { generateTypeId } from "@aop/infra";
import { serializeMessageOrigin } from "../chat-session/message-origin.ts";
import { nextChatTurnIndex } from "../chat-session/turn-order.ts";
import type { ChatSession } from "../db/schema.ts";
import type { PublisherTransaction } from "../event-log/publisher.ts";
import { recordMessageCreated, recordThreadUpserted } from "../project/events.ts";
import { toWireMessage } from "../project/wire-messages.ts";
import { hasQueuedMessage } from "../scheduling/queue.ts";
import { createThreadRepository, type ThreadPatch } from "./repository.ts";
import { canWaitOnRateLimit, closingStatusLine, statusAfterTurn, type TurnEnd } from "./state.ts";

const REPORT_TEXT_MAX = 3000;

interface EndedTurn {
  end: TurnEnd;
  /** What the agent said last, or the failure message. */
  text: string;
  /** With `end` `rate-limited`: when the thread resumes by itself. */
  resumesAt?: string;
}

/**
 * A thread's agent finished a turn. Moves the thread to where the turn leaves it, records it
 * in the event log, and, when the thread has nothing more queued, reports to the project's
 * coordinator through its inbox. Returns the coordinator's session id when it must be woken.
 * A turn a rate limit refused is not reported: it is not over, the thread resumes by itself.
 */
export const settleThreadTurn = async (
  tx: PublisherTransaction,
  session: ChatSession,
  turn: EndedTurn,
): Promise<string[]> => {
  const threads = createThreadRepository(tx.db);
  const thread = await threads.getById(session.id);
  if (!thread) return [];
  // A thread that is resolved, landing or waiting on a question cannot be put on hold: the limit
  // is that turn's failure.
  const end =
    turn.end === "rate-limited" && !canWaitOnRateLimit(thread.status) ? "failed" : turn.end;
  const queued = await hasQueuedMessage(tx.db, session.id);
  const change = statusAfterTurn(thread, end, queued, turn.resumesAt);
  await threads.update(session.id, {
    ...(change && { status: change }),
    ...closingFields(thread, { ...turn, end }, queued, change?.status === "rate-limited"),
    lastActivityAt: new Date().toISOString(),
  });
  await recordThreadUpserted(tx, session.id);
  if (queued) return [];

  const settled = await threads.getById(session.id);
  return settled ? reportToCoordinator(tx, settled, { ...turn, end }) : [];
};

// What the thread shows once its turn is over. Nothing changes while another turn is about to
// start, except that a thread put on hold says so; a status line the thread reported itself
// outlives its turn, but the wait is not the thread's to word.
const closingFields = (
  thread: Thread,
  turn: EndedTurn,
  queued: boolean,
  onHold: boolean,
): Pick<ThreadPatch, "liveStatusLine" | "unread"> => {
  if (queued && !onHold) return {};
  const closing = closingStatusLine(turn.end, turn.text);
  return {
    liveStatusLine: onHold ? closing : (thread.liveStatusLine ?? closing),
    unread: turn.end === "completed" || turn.end === "failed" || onHold,
  };
};

// A stopped thread reports nothing (the person or the coordinator did it), and a paused or
// archived project's coordinator is not woken.
const reportToCoordinator = async (
  tx: PublisherTransaction,
  thread: Thread,
  turn: EndedTurn,
): Promise<string[]> => {
  const outcome = reportOutcome(thread, turn.end);
  if (!outcome) return [];
  const coordinator = await tx.db
    .selectFrom("chat_sessions")
    .innerJoin("projects", "projects.id", "chat_sessions.project_id")
    .select("chat_sessions.id")
    .where("chat_sessions.project_id", "=", thread.projectId)
    .where("chat_sessions.kind", "=", "coordinator")
    .where("projects.status", "=", "active")
    .executeTakeFirst();
  if (!coordinator) return [];

  const now = new Date().toISOString();
  const text = reportText(thread, outcome, turn.text);
  const row = await tx.db
    .insertInto("chat_messages")
    .values({
      id: generateTypeId("smsg"),
      session_id: coordinator.id,
      role: "user",
      content: text,
      turn_index: await nextChatTurnIndex(tx.db, coordinator.id),
      disposition: "queued",
      created_at: now,
      origin_json: serializeMessageOrigin({
        type: "thread-report",
        threadId: thread.id,
        outcome,
      }),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const message = toWireMessage({ projectId: thread.projectId, threadId: null }, row);
  if (message) await recordMessageCreated(tx, message);
  return [coordinator.id];
};

const reportOutcome = (thread: Thread, end: TurnEnd): ThreadReportOutcome | null => {
  if (end === "failed") return "failed";
  if (end !== "completed") return null;
  return thread.status === "waiting-on-you" ? "needs-you" : "finished";
};

const reportText = (thread: Thread, outcome: ThreadReportOutcome, text: string): string => {
  const subject = `Thread report: "${thread.title}" (${thread.id})`;
  if (outcome === "needs-you" && thread.status === "waiting-on-you") {
    const options = thread.blockedQuestion.options.map((option) => `- ${option.label}`);
    return [
      `${subject} is waiting on the person to decide: ${thread.blockedQuestion.question}`,
      ...(options.length > 0 ? ["Options:", ...options] : []),
    ].join("\n");
  }
  const body = text.length <= REPORT_TEXT_MAX ? text : `${text.slice(0, REPORT_TEXT_MAX)}…`;
  const head =
    outcome === "failed"
      ? `${subject} failed.`
      : `${subject} finished a turn and is now ${thread.status}.`;
  return `${head}\n\n${body}`;
};
