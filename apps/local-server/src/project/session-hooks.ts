import {
  type MessageBlock,
  MessageBlockSchema,
  type ThreadCardVariant,
  type ThreadStatus,
} from "@aop/common";
import { z } from "zod";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import type { FinalizedTurn, SessionHooks, TurnFollowUp } from "../chat-session/session-hooks.ts";
import type { ChatMessage, ChatSession } from "../db/schema.ts";
import type { EventPublisher, PublisherTransaction } from "../event-log/publisher.ts";
import { createThreadRepository } from "../thread/repository.ts";
import type { TurnEnd } from "../thread/state.ts";
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
      const wire = toWireMessage(scopeOf(session), message);
      if (wire) await recordMessageCreated(tx, wire);
    },

    onRunFinalized: async (tx, turn) => {
      liveSoFar.delete(turn.run.id);
      const session = await loadProjectSession(tx, turn.run.session_id);
      if (!session) return { wakeSessionIds: [] };
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
// resolved thread, and the previous turn's status line no longer describes what it is doing.
const startThreadWork = async (
  tx: PublisherTransaction,
  session: ChatSession,
  message: ChatMessage,
): Promise<void> => {
  await createThreadRepository(tx.db).update(session.id, {
    status: { status: "working" },
    liveStatusLine: null,
    unread: false,
    lastActivityAt: message.created_at,
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
  const wakeSessionIds = await settleThreadTurn(tx, session, {
    end: turnEnd(turn.outcome.status),
    text: wire && wire.role === "assistant" ? assistantText(wire.blocks) : "",
  });
  return { followUp: { wakeSessionIds }, replied: wire !== null };
};

const finishCoordinatorRun = async (
  tx: PublisherTransaction,
  session: ChatSession,
  turn: FinalizedTurn,
): Promise<Finished> => {
  const blocks = await runBlocks(tx, turn);
  const wire = toWireMessage(scopeOf(session), turn.assistantMessage, blocks);
  if (wire) await recordMessageCreated(tx, wire);
  return { followUp: { wakeSessionIds: [] }, replied: wire !== null };
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
    { type: "thread-card", threadId: thread.id, variant: cardVariant(thread.status) },
  ];
  await tx.db
    .updateTable("chat_runs")
    .set({ blocks_json: JSON.stringify(withCard) })
    .where("id", "=", turn.run.id)
    .execute();
  return withCard;
};

const cardVariant = (status: ThreadStatus): ThreadCardVariant => {
  if (status === "waiting-on-you") return "needs-call";
  return status === "working" || status === "landing" ? "live" : "done";
};

const turnEnd = (status: FinalizedTurn["outcome"]["status"]): TurnEnd => status;

const assistantText = (blocks: readonly MessageBlock[]): string =>
  blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
