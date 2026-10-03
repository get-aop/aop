import type { MessagePage, Thread, UserMessage } from "@aop/common";
import { beforeQuery, request } from "./request";

/** A page of a project's coordinator chat, oldest first: the latest, or the one before message `before`. */
export const listCoordinatorMessages = (projectId: string, before?: string): Promise<MessagePage> =>
  request<MessagePage>(`/projects/${encodeURIComponent(projectId)}/messages${beforeQuery(before)}`);

/**
 * Says something to the coordinator; the answer is the message as stored, not the coordinator's
 * reply. `images` are ids of images uploaded to the project, in order. While the coordinator
 * works, the message reaches its turn after the step it is on, or with `afterTurn` once the
 * turn has ended.
 */
export const sendCoordinatorMessage = async (
  projectId: string,
  text: string,
  images: readonly string[] = [],
  { afterTurn = false }: SendOptions = {},
): Promise<UserMessage> =>
  (
    await request<{ message: UserMessage }>(`/projects/${encodeURIComponent(projectId)}/messages`, {
      method: "POST",
      body: JSON.stringify(messageBody(text, images, afterTurn)),
    })
  ).message;

/**
 * "Interrupt now" on a message sent while the coordinator or a thread works: the step it is on
 * stops and it reads the message at once. A message held for after the turn goes in first.
 * `delivered` when it had already read it.
 */
export const interruptForMessage = async (
  projectId: string,
  messageId: string,
): Promise<"interrupted" | "delivered"> =>
  (
    await request<{ outcome: "interrupted" | "delivered" }>(
      `/projects/${encodeURIComponent(projectId)}/messages/${encodeURIComponent(messageId)}/interrupt`,
      { method: "POST" },
    )
  ).outcome;

/** How a message to an agent at work is delivered. */
export interface SendOptions {
  /** Held until the agent's current turn ends, instead of reaching it after its current step. */
  afterTurn?: boolean;
}

/** The body of a message to the coordinator or a thread. */
export const messageBody = (text: string, images: readonly string[], afterTurn: boolean) => ({
  text,
  ...(images.length > 0 && { images }),
  ...(afterTurn && { midRunMode: "queue" }),
});

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
