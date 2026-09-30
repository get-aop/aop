import type { Message, Project } from "@aop/common";
import type { PublisherTransaction } from "../event-log/publisher.ts";
import { createThreadRepository } from "../thread/repository.ts";

/*
 * Appends to the project event log through the event publisher, inside the transaction that
 * makes the change: an entry exists exactly when its change does, and open project streams
 * hear of it after the commit. Each entry carries the whole entity and clients apply it by id,
 * so entries never need to be merged.
 */

export const recordProjectUpserted = async (tx: PublisherTransaction, project: Project) => {
  await tx.append({ type: "project.upserted", projectId: project.id, payload: { project } });
};

export const recordProjectRemoved = async (tx: PublisherTransaction, projectId: string) => {
  await tx.append({ type: "project.removed", projectId, payload: {} });
};

/** Reads the thread as the transaction sees it, so the entry matches the change just made. */
export const recordThreadUpserted = async (tx: PublisherTransaction, threadId: string) => {
  const thread = await createThreadRepository(tx.db).getById(threadId);
  if (!thread) return;
  await tx.append({ type: "thread.upserted", projectId: thread.projectId, payload: { thread } });
};

export const recordThreadRemoved = async (
  tx: PublisherTransaction,
  projectId: string,
  threadId: string,
) => {
  await tx.append({ type: "thread.removed", projectId, payload: { threadId } });
};

export const recordMessageCreated = async (tx: PublisherTransaction, message: Message) => {
  await tx.append({ type: "message.created", projectId: message.projectId, payload: { message } });
};

/** A message that changed after it was created: clients replace the copy they hold. */
export const recordMessageUpdated = async (tx: PublisherTransaction, message: Message) => {
  await tx.append({ type: "message.updated", projectId: message.projectId, payload: { message } });
};
