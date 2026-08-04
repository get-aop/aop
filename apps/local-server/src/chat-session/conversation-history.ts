import { parseControlCommand, parseRuntimeDelegation } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { ChatContextStrategy, ChatRunStatus, ChatSession } from "../db/schema.ts";
import {
  buildConversationContext,
  type ConversationContextMessage,
} from "./conversation-context.ts";
import { decodeStoredAttachmentMetadata } from "./message-images.ts";

export const prepareConversationPrompt = async (input: {
  ctx: LocalServerContext;
  session: ChatSession;
  currentUserMessageId: string;
  currentPrompt: string;
  excludeMessageIds?: string[];
}): Promise<{ strategy: ChatContextStrategy; prompt: string }> => {
  if (input.session.runtime_session_id) {
    return { strategy: "native_resume", prompt: input.currentPrompt };
  }

  const [allMessages, runs] = await Promise.all([
    input.ctx.db
      .selectFrom("chat_messages")
      .selectAll()
      .where("session_id", "=", input.session.id)
      .orderBy("turn_index")
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    input.ctx.db
      .selectFrom("chat_runs")
      .selectAll()
      .where("session_id", "=", input.session.id)
      .execute(),
  ]);
  const byUser = new Map(runs.map((run) => [run.user_message_id, run]));
  const byAssistant = new Map(runs.map((run) => [run.assistant_message_id, run]));
  const current = allMessages.find((message) => message.id === input.currentUserMessageId);
  const excluded = new Set([input.currentUserMessageId, ...(input.excludeMessageIds ?? [])]);
  const messages = allMessages.filter((message) => {
    if (excluded.has(message.id)) return false;
    if (current && message.turn_index >= current.turn_index) return false;
    if (message.role === "user" && !byUser.has(message.id)) return false;
    return true;
  });
  const history = messages.flatMap<ConversationContextMessage>((message) => {
    const run = message.role === "user" ? byUser.get(message.id) : byAssistant.get(message.id);
    const outcome = semanticOutcome(run?.status);
    if (message.role === "assistant" && outcome === "interrupted") {
      const partial = activityContent(message.activity);
      return partial ? [{ role: "assistant", content: partial, outcome }] : [];
    }
    return [{ role: message.role, content: visibleHistoryText(message.content), outcome }];
  });
  const transcript = buildConversationContext(history);
  if (!transcript) return { strategy: "fresh", prompt: input.currentPrompt };

  return {
    strategy: "aop_history",
    prompt: [
      "<aop_conversation_context>",
      "The native runtime session is unavailable. Continue this AOP conversation using",
      "the bounded transcript below. The latest current request is authoritative.",
      "",
      transcript,
      "</aop_conversation_context>",
      "",
      "<current_user_request>",
      input.currentPrompt,
      "</current_user_request>",
    ].join("\n"),
  };
};

const semanticOutcome = (
  status: ChatRunStatus | undefined,
): ConversationContextMessage["outcome"] => {
  if (status === "failed") return "failed";
  if (status === "interrupted") return "interrupted";
  if (status === "cancelled" || status === "running") return "cancelled";
  return "completed";
};

const visibleHistoryText = (content: string): string => {
  const decoded = decodeStoredAttachmentMetadata(content);
  const attachmentNames = decoded.documents.map((document) => document.originalFileName);
  let inertText = decoded.text;
  const delegation = parseRuntimeDelegation(inertText);
  if (delegation && !("error" in delegation)) inertText = delegation.prompt;
  const control = parseControlCommand(inertText);
  if (control && !("error" in control)) inertText = control.prompt;
  const text = inertText
    .replace(/\$DELEGATE_[A-Z0-9_-]+(?:\[[^\]]*\])?/g, "")
    .replace(/\$[A-Z0-9_-]+(?:\[[^\]]*\])?/g, "")
    .trim();
  return attachmentNames.length > 0
    ? `${text}\n[Attachments: ${attachmentNames.join(", ")}]`
    : text;
};

const activityContent = (raw: string | null): string => {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { content?: unknown };
    return typeof parsed.content === "string" ? parsed.content.trim() : "";
  } catch {
    return "";
  }
};
