import type { ChatActionPayload, TurnPart } from "@aop/common";
import type { Kysely } from "kysely";
import type {
  ChatMessage,
  ChatRun,
  ChatRunFailureKind,
  ChatRunInterruptionKind,
  Database,
} from "../db/schema.ts";
import type { RateLimitHit } from "../scheduling/rate-limit.ts";
import { encodeMessageContent, type StoredChatArtifact } from "./message-images.ts";
import { finalizeTurnParts } from "./turn-parts.ts";

type SessionBindingPolicy = "preserve" | "set" | "clear";

export type FinalizeChatRunOutcome = {
  status: "completed" | "failed" | "interrupted" | "cancelled";
  errorMessage: string | null;
  failureKind?: ChatRunFailureKind | null;
  interruptionKind?: ChatRunInterruptionKind | null;
  bindingPolicy?: SessionBindingPolicy;
  runtimeSessionState?: ChatRun["runtime_session_state"];
  /** Set on a failed run that a rate or usage limit refused: the session waits and resumes instead of failing. */
  rateLimit?: RateLimitHit;
};

const EMPTY_OUTPUT_FAILURE_KINDS = new Set<ChatRunFailureKind>(["startup_timeout", "empty_output"]);
const SECOND_EMPTY_OUTPUT_MESSAGE =
  "AOP reset the runtime session because the runtime produced no response twice. The next message will start a fresh runtime session.";

export const persistFinalizedChatRun = async (
  trx: Kysely<Database>,
  run: ChatRun,
  text: string,
  action: ChatActionPayload | null,
  runtimeSessionId: string | null,
  outcome: FinalizeChatRunOutcome,
  /** What the turn produced up to its end; null when no runtime ran. */
  parts: readonly TurnPart[] | null,
  artifacts: StoredChatArtifact[] = [],
): Promise<ChatMessage | null | undefined> => {
  const current = await trx
    .selectFrom("chat_runs")
    .selectAll()
    .where("id", "=", run.id)
    .executeTakeFirst();
  if (current?.status !== "running") return null;

  const createdAt = new Date().toISOString();
  const decision = await resolveBindingDecision(trx, current, outcome, runtimeSessionId, text);
  const userMessage = await trx
    .selectFrom("chat_messages")
    .select("turn_index")
    .where("id", "=", current.user_message_id)
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("chat_messages")
    .values({
      id: current.assistant_message_id,
      session_id: current.session_id,
      role: "assistant",
      content: encodeMessageContent(decision.assistantText, [], [], artifacts),
      action: action ? JSON.stringify(action) : null,
      parts: parts ? JSON.stringify(endTurn(parts, decision.assistantText, outcome)) : null,
      turn_index: userMessage.turn_index,
      disposition: "immediate",
      created_at: createdAt,
    })
    .onConflict((conflict) => conflict.column("id").doNothing())
    .execute();

  const claimed = await trx
    .updateTable("chat_runs")
    .set({
      status: outcome.status,
      runtime_session_id: runtimeSessionId ?? current.runtime_session_id,
      runtime_session_state: outcome.runtimeSessionState ?? current.runtime_session_state,
      failure_kind: outcome.failureKind ?? null,
      interruption_kind: outcome.interruptionKind ?? null,
      error_message: decision.errorMessage,
      updated_at: createdAt,
    })
    .where("id", "=", current.id)
    .where("status", "=", "running")
    .returning("id")
    .executeTakeFirst();
  if (!claimed) return null;

  await applySessionBindingPolicy(
    trx,
    current.session_id,
    decision.bindingPolicy,
    runtimeSessionId,
    createdAt,
  );
  return trx
    .selectFrom("chat_messages")
    .selectAll()
    .where("id", "=", current.assistant_message_id)
    .executeTakeFirst();
};

// The text the reply ends with is decided here (a reset of the runtime session says so instead of
// what the run said), so the turn's parts end with the same words as the message.
const endTurn = (
  parts: readonly TurnPart[],
  text: string,
  outcome: FinalizeChatRunOutcome,
): TurnPart[] =>
  finalizeTurnParts(parts, {
    text,
    failed: outcome.status === "failed",
    aborted: outcome.status === "cancelled",
    interrupted: outcome.status === "interrupted",
  });

const resolveBindingDecision = async (
  trx: Kysely<Database>,
  current: ChatRun,
  outcome: FinalizeChatRunOutcome,
  runtimeSessionId: string | null,
  text: string,
): Promise<{
  bindingPolicy: SessionBindingPolicy;
  assistantText: string;
  errorMessage: string | null;
}> => {
  if (outcome.bindingPolicy) {
    return {
      bindingPolicy: outcome.bindingPolicy,
      assistantText: text,
      errorMessage: outcome.errorMessage,
    };
  }
  if (outcome.runtimeSessionState === "confirmed" && runtimeSessionId) {
    return { bindingPolicy: "set", assistantText: text, errorMessage: outcome.errorMessage };
  }

  const failureKind = outcome.failureKind ?? null;
  if (isEmptyOutputFailure(outcome.status, failureKind) && current.resume_session_id) {
    return resolveEmptyOutputBindingDecision(trx, current, text, outcome.errorMessage);
  }
  if (outcome.status === "completed" && runtimeSessionId) {
    return { bindingPolicy: "set", assistantText: text, errorMessage: outcome.errorMessage };
  }
  return { bindingPolicy: "preserve", assistantText: text, errorMessage: outcome.errorMessage };
};

const resolveEmptyOutputBindingDecision = async (
  trx: Kysely<Database>,
  current: ChatRun,
  text: string,
  errorMessage: string | null,
): Promise<{
  bindingPolicy: SessionBindingPolicy;
  assistantText: string;
  errorMessage: string | null;
}> => {
  const preceding = await trx
    .selectFrom("chat_runs")
    .select(["failure_kind", "status", "resume_session_id"])
    .where("session_id", "=", current.session_id)
    .where("id", "!=", current.id)
    .where("status", "!=", "running")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (
    preceding?.status === "failed" &&
    isEmptyOutputFailure("failed", preceding.failure_kind ?? null) &&
    preceding.resume_session_id === current.resume_session_id
  ) {
    return {
      bindingPolicy: "clear",
      assistantText: SECOND_EMPTY_OUTPUT_MESSAGE,
      errorMessage: SECOND_EMPTY_OUTPUT_MESSAGE,
    };
  }
  return { bindingPolicy: "preserve", assistantText: text, errorMessage };
};

const applySessionBindingPolicy = async (
  trx: Kysely<Database>,
  sessionId: string,
  policy: SessionBindingPolicy,
  runtimeSessionId: string | null,
  updatedAt: string,
): Promise<void> => {
  if (policy === "set" && runtimeSessionId) {
    // Never overwrite a different existing binding (same invariant as mid-run
    // persistActiveRuntimeSession). The run may still record the discovered id.
    await trx
      .updateTable("chat_sessions")
      .set({ runtime_session_id: runtimeSessionId, updated_at: updatedAt })
      .where("id", "=", sessionId)
      .where((eb) =>
        eb.or([
          eb("runtime_session_id", "is", null),
          eb("runtime_session_id", "=", runtimeSessionId),
        ]),
      )
      .execute();
    return;
  }
  if (policy === "clear") {
    await trx
      .updateTable("chat_sessions")
      .set({ runtime_session_id: null, updated_at: updatedAt })
      .where("id", "=", sessionId)
      .execute();
  }
};

const isEmptyOutputFailure = (
  status: FinalizeChatRunOutcome["status"],
  failureKind: ChatRunFailureKind | null,
): boolean =>
  status === "failed" && failureKind !== null && EMPTY_OUTPUT_FAILURE_KINDS.has(failureKind);
