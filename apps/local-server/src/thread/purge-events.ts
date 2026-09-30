import type { SessionDeletion } from "../chat-session/history-maintenance.ts";
import { recordThreadRemoved } from "../project/events.ts";
import { recordSuggestionsChanged } from "../suggestion/events.ts";
import { createSuggestionRepository } from "../suggestion/repository.ts";

/**
 * For deletions that take threads along with something else (a repo leaving the host): each
 * thread that goes is logged as removed in the transaction that deletes it, and the proposals
 * it was started from open again, exactly as when a person deletes the thread.
 */
export const announceThreadRemoval: SessionDeletion = async (tx, session, remove) => {
  const { project_id: projectId } = session;
  if (session.kind !== "thread" || !projectId) return remove();

  // The answers go with the thread, so the proposals it answered are read before.
  const reopened = await createSuggestionRepository(tx.db).messagesStartedAs(session.id);
  const removed = await remove();
  if (removed.deleted) {
    await recordThreadRemoved(tx, projectId, session.id);
    await recordSuggestionsChanged(tx, projectId, reopened);
  }
  return removed;
};
