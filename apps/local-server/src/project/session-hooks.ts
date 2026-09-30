import { type MessageBlock, MessageBlockSchema, threadCardVariant } from "@aop/common";
import { z } from "zod";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import type {
  FinalizedTurn,
  SchedulePhase,
  SessionHooks,
  TurnFollowUp,
} from "../chat-session/session-hooks.ts";
import type { ChatMessage, ChatSession } from "../db/schema.ts";
import type { EventPublisher, PublisherTransaction } from "../event-log/publisher.ts";
import { holdCoordinator, releaseCoordinator } from "../scheduling/hold.ts";
import { createThreadRepository } from "../thread/repository.ts";
import { statusAfterSchedule, type TurnEnd } from "../thread/state.ts";
import { settleThreadTurn } from "../thread/turn-outcome.ts";
import { recordMessageCreated, recordThreadUpserted } from "./events.ts";
import { scopeOf, toWireMessage } from "./wire-messages.ts";

/**
 * The project domain's side of the engine's session hooks (see chat-session/session-hooks.ts):
 * keeps a thread's status, the coordinator's inbox and the event log in step with the chat
 * engine, and shows a reply being written as it is.
 */
export const createProjectSessionHooks = (publisher: EventPublisher): SessionHooks => {
  // What of each running reply clients already have, so a progress snapshot goes out as its new suffix.
  const liveSoFar = new Map<string, string>();

  return {
    onUserMessageStored: async (tx, message) => {
      const session = await loadProjectSession(tx, message.session_id);
      if (!session) return;
      if (session.kind === "thread") await startThreadWork(tx, session, message);
      // A person's message to a coordinator ends its wait on a rate limit: sending it is a retry.
      else await releaseCoordinator(tx.db, session.id);
      const wire = toWireMessage(scopeOf(session), message);
      if (wire) await recordMessageCreated(tx, wire);
    },

    onTurnScheduled: async (tx, sessionId, phase) => {
      const session = await loadProjectSession(tx, sessionId);
      if (!session) return;
      if (session.kind === "thread") await scheduleThreadTurn(tx, session, phase);
      else if (phase === "running") await releaseCoordinator(tx.db, session.id);
    },

    onRunFinalized: async (tx, turn) => {
      liveSoFar.delete(turn.run.id);
      const session = await loadProjectSession(tx, turn.run.session_id);
      if (!session) return { wakeSessionIds: [], resume: null };
      const { followUp, replied } =
        session.kind === "thread"
          ? await finishThreadRun(tx, session, turn)
          : await finishCoordinatorRun(tx, session, turn);
      // A turn that ends with nothing to show has no message.created to replace its live text.
      if (!replied) {
        const { projectId, threadId } = scopeOf(session);
        publisher.clearLive(projectId, threadId, turn.assistantMessage.id);
      }
      return followUp;
    },

    onAssistantProgress: (session, run, text) => {
      if (!session.project_id) return;
      const before = liveSoFar.get(run.id) ?? "";
      const appended = text.startsWith(before);
      const delta = appended ? text.slice(before.length) : text;
      if (appended && delta === "") return;
      liveSoFar.set(run.id, text);
      publisher.publishLive({
        projectId: session.project_id,
        threadId: session.kind === "thread" ? session.id : null,
        messageId: run.assistant_message_id,
        text: delta,
        replace: !appended,
      });
    },
  };
};

const loadProjectSession = async (
  tx: PublisherTransaction,
  sessionId: string,
): Promise<ChatSession | null> => {
  const session = await tx.db
    .selectFrom("chat_sessions")
    .selectAll()
    .where("id", "=", sessionId)
    .executeTakeFirst();
  return session?.project_id ? session : null;
};

// A message to a thread is work for it: a reply clears its question, a message reopens a
// resolved thread, ends a wait on a rate limit, and the previous turn's status line no longer
// describes what it is doing. A thread already queued stays queued: another message does not
// move it up.
const startThreadWork = async (
  tx: PublisherTransaction,
  session: ChatSession,
  message: ChatMessage,
): Promise<void> => {
  await createThreadRepository(tx.db).update(session.id, {
    ...(session.state !== "queued" && { status: { status: "working" }, liveStatusLine: null }),
    unread: false,
    lastActivityAt: message.created_at,
  });
  await recordThreadUpserted(tx, session.id);
};

// The run queue moved a thread's turn: the change is the thread's status and, while it waits,
// the line that says why.
const scheduleThreadTurn = async (
  tx: PublisherTransaction,
  session: ChatSession,
  phase: SchedulePhase,
): Promise<void> => {
  if (!session.state) return;
  const change = statusAfterSchedule(session.state, phase);
  if (!change) return;
  await createThreadRepository(tx.db).update(session.id, {
    status: { status: change.status },
    liveStatusLine: change.liveStatusLine,
  });
  await recordThreadUpserted(tx, session.id);
};

interface Finished {
  followUp: TurnFollowUp;
  /** A message.created entry was written for the reply. */
  replied: boolean;
}

const finishThreadRun = async (
  tx: PublisherTransaction,
  session: ChatSession,
  turn: FinalizedTurn,
): Promise<Finished> => {
  const wire = toWireMessage(scopeOf(session), turn.assistantMessage);
  if (wire) await recordMessageCreated(tx, wire);
  const { rateLimit } = turn.outcome;
  const wakeSessionIds = await settleThreadTurn(tx, session, {
    end: rateLimit ? "rate-limited" : turnEnd(turn.outcome.status),
    text: wire && wire.role === "assistant" ? assistantText(wire.blocks) : "",
    resumesAt: rateLimit?.resumesAt,
  });
  // The thread may not have gone on hold (it was resolved, say): only a thread that did has a timer to arm.
  const settled = await createThreadRepository(tx.db).getById(session.id);
  const resume =
    settled?.status === "rate-limited" ? { sessionId: session.id, at: settled.resumesAt } : null;
  return { followUp: { wakeSessionIds, resume }, replied: wire !== null };
};

const finishCoordinatorRun = async (
  tx: PublisherTransaction,
  session: ChatSession,
  turn: FinalizedTurn,
): Promise<Finished> => {
  const blocks = await runBlocks(tx, turn);
  const wire = toWireMessage(scopeOf(session), turn.assistantMessage, blocks);
  if (wire) await recordMessageCreated(tx, wire);
  // A coordinator has no status to show the wait in; its reply says it, and the hold makes its
  // inbox wait too, so reports that arrive meanwhile are not spent on runs the limit would refuse.
  const { rateLimit } = turn.outcome;
  if (rateLimit) await holdCoordinator(tx.db, session.id, rateLimit.resumesAt);
  const resume = rateLimit ? { sessionId: session.id, at: rateLimit.resumesAt } : null;
  return { followUp: { wakeSessionIds: [], resume }, replied: wire !== null };
};

// Blocks the run's tools recorded, plus the card of the thread a report woke the coordinator
// about: the person sees the coordinator's reply next to the thread it is about.
const runBlocks = async (
  tx: PublisherTransaction,
  turn: FinalizedTurn,
): Promise<MessageBlock[]> => {
  const run = await tx.db
    .selectFrom("chat_runs")
    .select("blocks_json")
    .where("id", "=", turn.run.id)
    .executeTakeFirstOrThrow();
  const blocks = z.array(MessageBlockSchema).parse(JSON.parse(run.blocks_json));
  if (turn.outcome.status !== "completed") return blocks;

  const trigger = await tx.db
    .selectFrom("chat_messages")
    .select("origin_json")
    .where("id", "=", turn.run.user_message_id)
    .executeTakeFirst();
  const origin = parseMessageOrigin(trigger?.origin_json ?? null);
  if (origin?.type !== "thread-report") return blocks;
  if (blocks.some((block) => block.type === "thread-card" && block.threadId === origin.threadId)) {
    return blocks;
  }
  const thread = await createThreadRepository(tx.db).getById(origin.threadId);
  if (!thread) return blocks;

  const withCard: MessageBlock[] = [
    ...blocks,
    { type: "thread-card", threadId: thread.id, variant: threadCardVariant(thread.status) },
  ];
  await tx.db
    .updateTable("chat_runs")
    .set({ blocks_json: JSON.stringify(withCard) })
    .where("id", "=", turn.run.id)
    .execute();
  return withCard;
};

const turnEnd = (status: FinalizedTurn["outcome"]["status"]): TurnEnd => status;

const assistantText = (blocks: readonly MessageBlock[]): string =>
  blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
