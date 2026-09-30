import type { ChatMessage, ChatRun, ChatSession } from "../db/schema.ts";
import type { PublisherTransaction } from "../event-log/publisher.ts";
import type { FinalizeChatRunOutcome } from "./run-finalization.ts";

/**
 * What the chat engine tells the project domain. The two transaction hooks run inside the
 * transaction that makes the change, so a thread's status, the coordinator's inbox and the
 * event log entries commit together with the message or run that caused them, and open
 * streams hear of them after the commit. The engine owns turns; it must not import the project
 * domain, so the domain hands its implementation to the context (`LocalServerContext.sessionHooks`).
 * Every hook ignores sessions that belong to no project.
 */
export interface SessionHooks {
  /** A user-side message row was stored: typed, queued mid-run, or written by the server. */
  onUserMessageStored: (tx: PublisherTransaction, message: ChatMessage) => Promise<void>;
  /** A run reached its terminal state and its assistant message was stored. */
  onRunFinalized: (tx: PublisherTransaction, turn: FinalizedTurn) => Promise<TurnFollowUp>;
  /** The run's reply so far (`text` is everything written up to now), for clients showing it live. */
  onAssistantProgress: (session: ChatSession, run: ChatRun, text: string) => void;
}

export interface FinalizedTurn {
  run: ChatRun;
  outcome: FinalizeChatRunOutcome;
  assistantMessage: ChatMessage;
}

export interface TurnFollowUp {
  /** Sessions with a new queued message; the engine starts their next run once the transaction commits. */
  wakeSessionIds: string[];
}
