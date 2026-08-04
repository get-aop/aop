import type { ChatActionPayload, ChatDelegationRun } from "@aop/common";
import { parseChatDelegationRuns, serializeChatDelegationRuns } from "@aop/common";
import type { Transaction } from "kysely";
import type {
  ChatMessage,
  ChatRun,
  ChatRunFailureKind,
  ChatRunInterruptionKind,
  Database,
} from "../db/schema.ts";
import {
  cascadeDelegationsForHostTerminal,
  publishDelegationUpdate,
  toDelegationDto,
} from "./delegation-runs.ts";
import { encodeMessageContent, type StoredChatArtifact } from "./message-images.ts";
import { isGrokRuntime } from "./runtime-engine.ts";

type SessionBindingPolicy = "preserve" | "set" | "clear";

export type FinalizeChatRunOutcome = {
  status: "completed" | "failed" | "interrupted" | "cancelled";
  errorMessage: string | null;
  failureKind?: ChatRunFailureKind | null;
  interruptionKind?: ChatRunInterruptionKind | null;
  bindingPolicy?: SessionBindingPolicy;
  runtimeSessionState?: ChatRun["runtime_session_state"];
};

const EMPTY_OUTPUT_FAILURE_KINDS = new Set<ChatRunFailureKind>(["startup_timeout", "empty_output"]);
const SECOND_EMPTY_OUTPUT_MESSAGE =
  "AOP reset the runtime session because the runtime produced no response twice. The next message will start a fresh runtime session.";
const GROK_RESUME_SILENCE_RESET_MESSAGE =
  "AOP reset the runtime session because Grok produced no response while resuming. The next message will start a fresh runtime session.";

export const persistFinalizedChatRun = async (
  trx: Transaction<Database>,
  run: ChatRun,
  text: string,
  action: ChatActionPayload | null,
  runtimeSessionId: string | null,
  outcome: FinalizeChatRunOutcome,
  activity: unknown | null,
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
      activity: activity ? JSON.stringify(activity) : null,
      turn_index: userMessage.turn_index,
      disposition: "immediate",
      created_at: createdAt,
    })
    .onConflict((conflict) => conflict.column("id").doNothing())
    .execute();

  // Re-read under this transaction so concurrent progress notes/starts are not lost
  // by cascading a stale snapshot of delegation_runs.
  const latestDelegationRuns = await trx
    .selectFrom("chat_runs")
    .select("delegation_runs")
    .where("id", "=", current.id)
    .executeTakeFirst();
  const delegationCascade = buildDelegationCascade(
    latestDelegationRuns?.delegation_runs ?? current.delegation_runs,
    outcome,
    createdAt,
  );
  const claimed = await trx
    .updateTable("chat_runs")
    .set({
      status: outcome.status,
      runtime_session_id: runtimeSessionId ?? current.runtime_session_id,
      runtime_session_state: outcome.runtimeSessionState ?? current.runtime_session_state,
      failure_kind: outcome.failureKind ?? null,
      interruption_kind: outcome.interruptionKind ?? null,
      error_message: decision.errorMessage,
      ...delegationCascade.set,
      updated_at: createdAt,
    })
    .where("id", "=", current.id)
    .where("status", "=", "running")
    .returning("id")
    .executeTakeFirst();
  if (!claimed) return null;

  await publishDelegationCascade(trx, current, outcome, delegationCascade.entries);

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

const buildDelegationCascade = (
  delegationRuns: string | null,
  outcome: FinalizeChatRunOutcome,
  createdAt: string,
): { set: { delegation_runs?: string | null }; entries: ChatDelegationRun[] } => {
  const cascade = cascadeDelegationsForHostTerminal(
    parseChatDelegationRuns(delegationRuns),
    outcome.status,
    createdAt,
  );
  return {
    set:
      cascade.changed.length === 0
        ? {}
        : { delegation_runs: serializeChatDelegationRuns(cascade.entries) },
    entries: cascade.entries,
  };
};

const publishDelegationCascade = async (
  trx: Transaction<Database>,
  current: ChatRun,
  outcome: FinalizeChatRunOutcome,
  changed: ChatDelegationRun[],
): Promise<void> => {
  if (changed.length === 0) return;
  const session = await trx
    .selectFrom("chat_sessions")
    .select("title")
    .where("id", "=", current.session_id)
    .executeTakeFirst();
  for (const entry of changed) {
    publishDelegationUpdate(
      current.session_id,
      current.id,
      toDelegationDto(entry, {
        hostRunId: current.id,
        hostRunStatus: outcome.status,
        sessionId: current.session_id,
        sessionTitle: session?.title ?? null,
      }),
    );
  }
};

const resolveBindingDecision = async (
  trx: Transaction<Database>,
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
  trx: Transaction<Database>,
  current: ChatRun,
  text: string,
  errorMessage: string | null,
): Promise<{
  bindingPolicy: SessionBindingPolicy;
  assistantText: string;
  errorMessage: string | null;
}> => {
  if (isGrokRuntime(current.runtime)) {
    return {
      bindingPolicy: "clear",
      assistantText: GROK_RESUME_SILENCE_RESET_MESSAGE,
      errorMessage: GROK_RESUME_SILENCE_RESET_MESSAGE,
    };
  }

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
  trx: Transaction<Database>,
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
