import {
  diffTurnParts,
  type MessageBlock,
  MessageBlockSchema,
  type TurnPart,
  threadCardVariant,
} from "@aop/common";
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
import { recordMessageCreated, recordMessageUpdated, recordThreadUpserted } from "./events.ts";
import { recordReportedRuntime } from "./reported-runtime.ts";
import {
  displayText,
  getWireMessage,
  isFailedRun,
  scopeOf,
  toWireMessage,
} from "./wire-messages.ts";

/** Hears a thread's turn so far, every time the engine reports it. */
export type ThreadProgressListener = (session: ChatSession, parts: readonly TurnPart[]) => void;

export interface ProjectSessionHooks extends SessionHooks {
  /** Adds a listener to every thread's turn as it is written; returns what removes it. */
  observeThreadProgress: (listener: ThreadProgressListener) => () => void;
}

/**
 * The project domain's side of the engine's session hooks (see chat-session/session-hooks.ts):
 * keeps a thread's status, the coordinator's inbox and the event log in step with the chat
 * engine, and shows a reply being written as it is.
 */
export const createProjectSessionHooks = (publisher: EventPublisher): ProjectSessionHooks => {
  // What of each running reply clients already have, so a progress snapshot goes out as what changed.
  const liveSoFar = new Map<string, readonly TurnPart[]>();
  const progressListeners = new Set<ThreadProgressListener>();

  return {
    observeThreadProgress: (listener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },

    onUserMessageStored: async (tx, message) => {
      const session = await loadProjectSession(tx, message.session_id);
      if (!session) return;
      if (session.kind === "thread") await startThreadWork(tx, session, message);
      // A person's message to a coordinator ends its wait on a rate limit: sending it is a retry.
      else await releaseCoordinator(tx.db, session.id);
      const wire = toWireMessage(scopeOf(session), message);
      if (wire) await recordMessageCreated(tx, wire);
    },

    onUserMessageChanged: async (tx, message) => {
      const session = await loadProjectSession(tx, message.session_id);
      const wire = session ? await getWireMessage(tx.db, session, message.id) : null;
      if (wire) await recordMessageUpdated(tx, wire);
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
      await recordReportedRuntime(tx, session, turn.run);
      // A turn that ends with nothing to show has no message.created to replace its live text.
      if (!replied) {
        const { projectId, threadId } = scopeOf(session);
        publisher.clearLive(projectId, threadId, turn.assistantMessage.id);
      }
      return followUp;
    },

    onAssistantProgress: (session, run, parts) => {
      if (!session.project_id) return;
      if (session.kind === "thread") hear(progressListeners, session, parts);
      const ops = diffTurnParts(liveSoFar.get(run.id) ?? [], parts);
      if (ops.length === 0) return;
      liveSoFar.set(run.id, parts);
      publisher.publishLive({
        projectId: session.project_id,
        threadId: session.kind === "thread" ? session.id : null,
        messageId: run.assistant_message_id,
        inReplyTo: run.user_message_id,
        ops,
      });
    },
  };
};

const hear = (
  listeners: ReadonlySet<ThreadProgressListener>,
  session: ChatSession,
  parts: readonly TurnPart[],
): void => {
  for (const listener of listeners) listener(session, parts);
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
  const wire = toWireMessage(scopeOf(session), turn.assistantMessage, [], {
    failed: failedTurn(turn),
    inReplyTo: turn.run.user_message_id,
  });
  if (wire) await recordMessageCreated(tx, wire);
  const { rateLimit } = turn.outcome;
  const wakeSessionIds = await settleThreadTurn(tx, session, {
    end: rateLimit ? "rate-limited" : turnEnd(turn.outcome.status),
    // What the thread reports is its answer, not the paragraphs it said on the way to it.
    text: wire ? displayText(turn.assistantMessage) : "",
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
  const wire = toWireMessage(scopeOf(session), turn.assistantMessage, blocks, {
    failed: failedTurn(turn),
    inReplyTo: turn.run.user_message_id,
  });
  if (wire) await recordMessageCreated(tx, wire);
  // A coordinator has no status to show the wait in; its reply says it, and the hold makes its
  // inbox wait too, so reports that arrive meanwhile are not spent on runs the limit would refuse.
  const { rateLimit } = turn.outcome;
  if (rateLimit) await holdCoordinator(tx.db, session.id, rateLimit.resumesAt);
  const resume = rateLimit ? { sessionId: session.id, at: rateLimit.resumesAt } : null;
  return { followUp: { wakeSessionIds: [], resume }, replied: wire !== null };
};

// The same reading of the run as a later fetch of the messages makes, so a reply looks the same live and after a reload.
const failedTurn = ({ outcome }: FinalizedTurn): boolean =>
  isFailedRun(outcome.status, outcome.failureKind);

// Blocks the run's tools recorded, plus the card of each thread a report woke the coordinator
// about: the person sees the coordinator's reply next to the threads it is about.
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

  const cards: MessageBlock[] = [];
  for (const threadId of await reportedThreadIds(tx, turn.run)) {
    if (blocks.some((block) => block.type === "thread-card" && block.threadId === threadId)) {
      continue;
    }
    const thread = await createThreadRepository(tx.db).getById(threadId);
    if (thread) {
      cards.push({ type: "thread-card", threadId, variant: threadCardVariant(thread.status) });
    }
  }
  if (cards.length === 0) return blocks;

  const withCards = [...blocks, ...cards];
  await tx.db
    .updateTable("chat_runs")
    .set({ blocks_json: JSON.stringify(withCards) })
    .where("id", "=", turn.run.id)
    .execute();
  return withCards;
};

// The threads whose reports this run answered, oldest first: its own message, and the others of
// its batch, which share its log (see chat-session/report-batch.ts).
const reportedThreadIds = async (
  tx: PublisherTransaction,
  run: FinalizedTurn["run"],
): Promise<string[]> => {
  const answered = await tx.db
    .selectFrom("chat_runs")
    .innerJoin("chat_messages", "chat_messages.id", "chat_runs.user_message_id")
    .select("chat_messages.origin_json")
    .where("chat_runs.session_id", "=", run.session_id)
    .where("chat_runs.log_file_path", "=", run.log_file_path)
    .orderBy("chat_messages.turn_index")
    .orderBy("chat_messages.created_at")
    .orderBy("chat_messages.id")
    .execute();
  const ids = answered.flatMap(({ origin_json }) => {
    const origin = parseMessageOrigin(origin_json);
    // The survey's first report asks for a summary that links the thread: it gets no card.
    return origin?.type === "thread-report" && !origin.kickoff ? [origin.threadId] : [];
  });
  return [...new Set(ids)];
};

const turnEnd = (status: FinalizedTurn["outcome"]["status"]): TurnEnd => status;
