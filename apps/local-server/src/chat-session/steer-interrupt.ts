import type { LocalServerContext } from "../context.ts";
import type { ChatMessage } from "../db/schema.ts";
import { deliverToRunningTurn, hasTakenMessage, interruptRun } from "./run-input.ts";

/**
 * "Interrupt now" for a message sent while a turn runs. A message written into the running turn
 * waits there until the step the agent is on ends, which can be a long command. Interrupting
 * stops that step, and the agent reads the message at once, in the same run. A message held for
 * after the turn is written into it first. What the stopped step started may stop with it.
 *
 * - interrupted: the step was stopped and the message is on its way to the agent.
 * - delivered: the agent already took the message in, so there was nothing to stop.
 */
export type SteerInterruptResult =
  | { success: true; outcome: "interrupted" | "delivered" }
  | {
      success: false;
      /** MESSAGE_NOT_WAITING: the message waits on no running turn that can be interrupted. */
      error: { code: "MESSAGE_NOT_FOUND" } | { code: "MESSAGE_NOT_WAITING" };
    };

/** For a message of one of the project's conversations: its coordinator chat or a thread. */
export const interruptForMessage = async (
  ctx: LocalServerContext,
  projectId: string,
  messageId: string,
): Promise<SteerInterruptResult> => {
  const message = await ctx.db
    .selectFrom("chat_messages")
    .innerJoin("chat_sessions", "chat_sessions.id", "chat_messages.session_id")
    .selectAll("chat_messages")
    .where("chat_messages.id", "=", messageId)
    .where("chat_messages.role", "=", "user")
    .where("chat_sessions.project_id", "=", projectId)
    .executeTakeFirst();
  if (!message) return { success: false, error: { code: "MESSAGE_NOT_FOUND" } };
  const runId = message.steered_run_id ?? (await writeIntoRunningTurn(ctx, message));
  if (!runId) return notWaiting;
  const run = await ctx.db
    .selectFrom("chat_runs")
    .select("log_file_path")
    .where("id", "=", runId)
    .executeTakeFirst();
  if (!run) return notWaiting;
  if (await hasTakenMessage(run, message.id)) return { success: true, outcome: "delivered" };
  return (await interruptRun(ctx, runId)) ? { success: true, outcome: "interrupted" } : notWaiting;
};

const notWaiting = { success: false, error: { code: "MESSAGE_NOT_WAITING" } } as const;

// A message held for after the turn, which no turn has started for yet, goes into the running one.
const writeIntoRunningTurn = async (
  ctx: LocalServerContext,
  message: ChatMessage,
): Promise<string | null> => {
  const session = await ctx.chatSessionRepository.getById(message.session_id);
  if (!session) return null;
  return (await deliverToRunningTurn(ctx, session, message))?.id ?? null;
};
