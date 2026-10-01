import type { MessagePage, Thread, UserMessage } from "@aop/common";
import { beforeQuery, request } from "./request";

/** A page of a project's coordinator chat, oldest first: the latest, or the one before message `before`. */
export const listCoordinatorMessages = (projectId: string, before?: string): Promise<MessagePage> =>
  request<MessagePage>(`/projects/${encodeURIComponent(projectId)}/messages${beforeQuery(before)}`);

/**
 * Says something to the coordinator; the answer is the message as stored, not the coordinator's
 * reply. `images` are ids of images uploaded to the project, in order.
 */
export const sendCoordinatorMessage = async (
  projectId: string,
  text: string,
  images: readonly string[] = [],
): Promise<UserMessage> =>
  (
    await request<{ message: UserMessage }>(`/projects/${encodeURIComponent(projectId)}/messages`, {
      method: "POST",
      body: JSON.stringify(images.length > 0 ? { text, images } : { text }),
    })
  ).message;

const suggestionPath = (projectId: string, messageId: string, suggestionId: string): string =>
  `/projects/${encodeURIComponent(projectId)}/messages/${encodeURIComponent(messageId)}/suggestions/${encodeURIComponent(suggestionId)}`;

/**
 * Starts the thread a suggestion of the coordinator proposes. The host records the answer, so
 * asking again, from this browser or another, answers with the same thread.
 */
export const startSuggestion = async (
  projectId: string,
  messageId: string,
  suggestionId: string,
): Promise<Thread> =>
  (
    await request<{ thread: Thread }>(
      `${suggestionPath(projectId, messageId, suggestionId)}/start`,
      { method: "POST" },
    )
  ).thread;

/** Skips a suggestion. The host publishes the answer on the project's stream. */
export const skipSuggestion = async (
  projectId: string,
  messageId: string,
  suggestionId: string,
): Promise<void> => {
  await request(`${suggestionPath(projectId, messageId, suggestionId)}/skip`, { method: "POST" });
};

/** Takes a skip back, so the suggestion waits for an answer again. */
export const unskipSuggestion = async (
  projectId: string,
  messageId: string,
  suggestionId: string,
): Promise<void> => {
  await request(`${suggestionPath(projectId, messageId, suggestionId)}/skip`, {
    method: "DELETE",
  });
};
