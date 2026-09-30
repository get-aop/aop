import { createChatSessionRepository } from "../chat-session/repository.ts";
import type { PublisherTransaction } from "../event-log/publisher.ts";
import { recordMessageUpdated } from "../project/events.ts";
import { getWireMessage } from "../project/wire-messages.ts";

/**
 * Tells every client that the suggestions of these coordinator messages changed. Each message
 * goes out whole, as the host now sends it, so the entry can be applied by id like any other.
 * Read through the transaction, so it shows the answers written in it.
 */
export const recordSuggestionsChanged = async (
  tx: PublisherTransaction,
  projectId: string,
  messageIds: readonly string[],
): Promise<void> => {
  if (messageIds.length === 0) return;
  const coordinator = await createChatSessionRepository(tx.db).getCoordinator(projectId);
  if (!coordinator) return;
  for (const messageId of messageIds) {
    const message = await getWireMessage(tx.db, coordinator, messageId);
    if (message) await recordMessageUpdated(tx, message);
  }
};
