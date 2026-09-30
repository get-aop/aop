import type { Message, SuggestedThread, SuggestionAnswer } from "@aop/common";
import { createEventLogRepository } from "../event-log/repository.ts";
import type { ProjectStack } from "../project/test-utils.ts";

export interface Proposal {
  /** The coordinator message that holds the suggestions. */
  messageId: string;
  suggestions: SuggestedThread[];
}

/**
 * A finished coordinator turn whose reply proposes threads: the person's message, the reply,
 * and the run that carries the `suggested-threads` block, stored as the engine stores them.
 * Nothing runs a model.
 */
export const proposeThreads = async (
  s: ProjectStack,
  projectId: string,
  proposals: readonly Pick<SuggestedThread, "title" | "prompt" | "repoId">[],
): Promise<Proposal> => {
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(projectId);
  if (!coordinator) throw new Error("project has no coordinator");
  const id = crypto.randomUUID();
  const [userId, messageId] = [`msg_user_${id}`, `msg_reply_${id}`];
  const suggestions = proposals.map((proposal) => ({ id: crypto.randomUUID(), ...proposal }));
  const at = new Date().toISOString();

  await s.db
    .insertInto("chat_messages")
    .values([
      chatMessage(userId, coordinator.id, "user", "Suggest some threads", at),
      chatMessage(messageId, coordinator.id, "assistant", "Here are my suggestions.", at),
    ])
    .execute();
  await s.db
    .insertInto("chat_runs")
    .values({
      id: `run_${id}`,
      session_id: coordinator.id,
      user_message_id: userId,
      assistant_message_id: messageId,
      runtime: "claude-code",
      log_file_path: "run.jsonl",
      status: "completed",
      runtime_session_id: null,
      resume_session_id: null,
      failure_kind: null,
      interruption_kind: null,
      context_strategy: "fresh",
      workspace_path: null,
      timeout_policy: null,
      retry_of_run_id: null,
      runtime_session_state: null,
      error_message: null,
      pid: null,
      blocks_json: JSON.stringify([{ type: "suggested-threads", suggestions }]),
    })
    .execute();
  return { messageId, suggestions };
};

const chatMessage = (
  id: string,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  createdAt: string,
) => ({
  id,
  session_id: sessionId,
  role,
  content,
  turn_index: 1,
  disposition: "immediate" as const,
  created_at: createdAt,
  origin_json: null,
});

/** The answers a message's suggestions carry, in order: what a client reads from it. */
export const answersIn = (message: Message | undefined): (SuggestionAnswer | null)[] => {
  if (message?.role !== "assistant") return [];
  return message.blocks.flatMap((block) =>
    block.type === "suggested-threads"
      ? block.suggestions.map((suggestion) => suggestion.answer ?? null)
      : [],
  );
};

/** The coordinator message as the host lists it, which is what a client fetches. */
export const listedAnswers = async (
  s: ProjectStack,
  projectId: string,
  messageId: string,
): Promise<(SuggestionAnswer | null)[]> => {
  const listed = await s.services.projects.listMessages(projectId);
  return answersIn(listed.success ? listed.messages.find(({ id }) => id === messageId) : undefined);
};

/** The messages the project's stream announced with `message.updated`, oldest first. */
export const updatedMessages = async (s: ProjectStack, projectId: string): Promise<Message[]> =>
  (await createEventLogRepository(s.db).listAfter(projectId, 0)).flatMap((entry) =>
    entry.type === "message.updated" ? [entry.payload.message] : [],
  );

export const countThreads = async (s: ProjectStack, projectId: string): Promise<number> => {
  const listed = await s.services.threads.list(projectId);
  return listed.success ? listed.threads.length : 0;
};
