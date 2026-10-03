import { type CurrentStep, currentStepOf, describeStep, formatElapsed } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { hasTakenMessage } from "./run-input.ts";

/**
 * Where a message sent to a conversation stands, so whoever sent it knows it was not lost:
 * - waiting: written into the running turn, which reads it once the step it is on ends (`step`;
 *   null while the model writes rather than runs a tool).
 * - delivered: the running turn took it in.
 * - queued: it waits for a turn of its own, after the one that runs now or for a run slot.
 * - started: a turn of its own runs for it.
 */
export type SteerDelivery =
  | { state: "waiting"; step: CurrentStep | null }
  | { state: "delivered" }
  | { state: "queued" }
  | { state: "started" };

export const steerDeliveryOf = async (
  ctx: LocalServerContext,
  messageId: string,
): Promise<SteerDelivery | null> => {
  const message = await ctx.db
    .selectFrom("chat_messages")
    .innerJoin("chat_sessions", "chat_sessions.id", "chat_messages.session_id")
    .select(["chat_messages.steered_run_id", "chat_sessions.project_id"])
    .where("chat_messages.id", "=", messageId)
    .executeTakeFirst();
  if (!message) return null;
  if (message.steered_run_id) {
    const run = await ctx.db
      .selectFrom("chat_runs")
      .select(["log_file_path", "assistant_message_id"])
      .where("id", "=", message.steered_run_id)
      .executeTakeFirstOrThrow();
    if (await hasTakenMessage(run, messageId)) return { state: "delivered" };
    const parts = message.project_id
      ? ctx.eventPublisher.liveParts(message.project_id, run.assistant_message_id)
      : [];
    return { state: "waiting", step: currentStepOf(parts) };
  }
  const ownRun = await ctx.db
    .selectFrom("chat_runs")
    .select("id")
    .where("user_message_id", "=", messageId)
    .where("status", "!=", "cancelled")
    .executeTakeFirst();
  return { state: ownRun ? "started" : "queued" };
};

/** One sentence for an agent that sent the message (the coordinator's thread_steer). */
export const describeSteerDelivery = (
  delivery: SteerDelivery,
  { interrupted = false, now = Date.now() }: { interrupted?: boolean; now?: number } = {},
): string => {
  switch (delivery.state) {
    case "waiting": {
      const step = delivery.step ? stepLine(delivery.step, now) : null;
      if (interrupted) {
        return `Interrupted the step it was on${step ? ` (${step})` : ""}: it reads the message now.`;
      }
      return step
        ? `Written into its running turn: it reads the message once its current step ends (${step}). Steer again with when: "interrupt" to stop that step instead.`
        : "Written into its running turn: it reads the message after what it is writing now.";
    }
    case "delivered":
      return "It has read the message in its running turn.";
    case "queued":
      return "Queued: it reads the message in a turn of its own, once its current turn ends or a run slot frees.";
    case "started":
      return "Started a turn for the message.";
  }
};

const stepLine = (step: CurrentStep, now: number): string => {
  const elapsed = step.tool.startedAt ? formatElapsed(step.tool.startedAt, now) : "";
  return `${describeStep(step)}${elapsed ? `, running ${elapsed}` : ""}`;
};
