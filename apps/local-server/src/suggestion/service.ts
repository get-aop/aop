import type { MessageBlock, SuggestedThread, SuggestionAnswer, Thread } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { getWireMessage } from "../project/wire-messages.ts";
import { createKeyedQueue } from "../thread/keyed-queue.ts";
import type { ThreadService } from "../thread/service.ts";
import { recordSuggestionsChanged } from "./events.ts";
import { createSuggestionRepository, type SuggestionRepository } from "./repository.ts";
import type { SuggestionResult } from "./types.ts";

type Standing = SuggestionResult<{ answer: SuggestionAnswer | null }>;

/**
 * Answers to the threads the coordinator proposes. The host records each answer, so a proposal
 * answered on one device is answered on all of them, and starting one never makes a second thread.
 */
export interface SuggestionService {
  /**
   * Starts the thread a suggestion proposes, from the suggestion as the host holds it. A
   * suggestion that was already started answers with its thread and starts nothing.
   */
  start: (
    projectId: string,
    messageId: string,
    suggestionId: string,
  ) => Promise<SuggestionResult<{ thread: Thread; created: boolean }>>;
  /** Skips a suggestion. The answer that stands afterwards is returned: a started one is never skipped. */
  skip: (projectId: string, messageId: string, suggestionId: string) => Promise<Standing>;
  /** Takes a skip back, so the suggestion waits again. A started one stays started. */
  unskip: (projectId: string, messageId: string, suggestionId: string) => Promise<Standing>;
}

export const createSuggestionService = (
  ctx: LocalServerContext,
  threads: ThreadService,
): SuggestionService => {
  const answers = createSuggestionRepository(ctx.db);
  // One answer to a suggestion at a time: a second click waits for the first and finds its
  // answer. The primary key of the table is what still holds if two ever get past this.
  const queue = createKeyedQueue();
  const serialized = <T>(messageId: string, suggestionId: string, task: () => Promise<T>) =>
    queue(JSON.stringify([messageId, suggestionId]), task);

  const locate = async (
    projectId: string,
    messageId: string,
    suggestionId: string,
  ): Promise<SuggestionResult<{ suggestion: SuggestedThread }>> => {
    if (!(await ctx.projectRepository.getById(projectId))) {
      return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
    }
    const coordinator = await ctx.chatSessionRepository.getCoordinator(projectId);
    const message = coordinator ? await getWireMessage(ctx.db, coordinator, messageId) : null;
    const suggestion =
      message?.role === "assistant" ? findSuggestion(message.blocks, suggestionId) : null;
    return suggestion
      ? { success: true, suggestion }
      : { success: false, error: { code: "SUGGESTION_NOT_FOUND" } };
  };

  const startNew = async (
    projectId: string,
    messageId: string,
    { id, title, prompt, repoId }: SuggestedThread,
  ): Promise<SuggestionResult<{ thread: Thread; created: boolean }>> => {
    const spawned = await threads.spawn(projectId, {
      title,
      prompt,
      repoId,
      // The answer commits with the thread; it is what makes a second start find the first.
      inTransaction: async (tx, threadId) => {
        const recorded = await createSuggestionRepository(tx.db).recordStarted(
          messageId,
          id,
          threadId,
        );
        if (!recorded) throw new Error(`Suggestion ${id} was already started`);
        await recordSuggestionsChanged(tx, projectId, [messageId]);
      },
    });
    return spawned.success ? { ...spawned, created: true } : spawned;
  };

  // Clients hear of the change only when there was one.
  const changeSkip =
    (
      write: (repository: SuggestionRepository, messageId: string, id: string) => Promise<boolean>,
    ) =>
    async (projectId: string, messageId: string, suggestionId: string): Promise<Standing> => {
      const found = await locate(projectId, messageId, suggestionId);
      if (!found.success) return found;
      return serialized(messageId, suggestionId, () =>
        ctx.eventPublisher.transaction(async (tx) => {
          const repository = createSuggestionRepository(tx.db);
          if (await write(repository, messageId, suggestionId)) {
            await recordSuggestionsChanged(tx, projectId, [messageId]);
          }
          return { success: true as const, answer: await repository.get(messageId, suggestionId) };
        }),
      );
    };

  return {
    start: async (projectId, messageId, suggestionId) => {
      const found = await locate(projectId, messageId, suggestionId);
      if (!found.success) return found;
      return serialized(messageId, suggestionId, async () => {
        const answer = await answers.get(messageId, suggestionId);
        if (answer?.state !== "started") return startNew(projectId, messageId, found.suggestion);
        const existing = await threads.get(answer.threadId);
        return existing.success ? { ...existing, created: false } : existing;
      });
    },

    skip: changeSkip((repository, messageId, id) => repository.recordSkipped(messageId, id)),
    unskip: changeSkip((repository, messageId, id) => repository.clearSkipped(messageId, id)),
  };
};

const findSuggestion = (
  blocks: readonly MessageBlock[],
  suggestionId: string,
): SuggestedThread | null => {
  for (const block of blocks) {
    if (block.type !== "suggested-threads") continue;
    const found = block.suggestions.find(({ id }) => id === suggestionId);
    if (found) return found;
  }
  return null;
};
