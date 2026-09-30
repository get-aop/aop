import type { Message, SuggestedThread, Thread, UserMessage } from "@aop/common";
import { request } from "./request";

/** The latest messages of a project's coordinator chat, oldest first. */
export const listCoordinatorMessages = async (projectId: string): Promise<Message[]> =>
  (await request<{ messages: Message[] }>(`/projects/${encodeURIComponent(projectId)}/messages`))
    .messages;

/** Says something to the coordinator; the answer is the message as stored, not the coordinator's reply. */
export const sendCoordinatorMessage = async (
  projectId: string,
  text: string,
): Promise<UserMessage> =>
  (
    await request<{ message: UserMessage }>(`/projects/${encodeURIComponent(projectId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    })
  ).message;

/** Starts a thread the coordinator proposed: the host has no route of its own for accepting one. */
export const startSuggestedThread = async (
  projectId: string,
  suggestion: Pick<SuggestedThread, "title" | "prompt" | "repoId">,
): Promise<Thread> =>
  (
    await request<{ thread: Thread }>(`/projects/${encodeURIComponent(projectId)}/threads`, {
      method: "POST",
      body: JSON.stringify({
        title: suggestion.title,
        prompt: suggestion.prompt,
        repoId: suggestion.repoId,
      }),
    })
  ).thread;
