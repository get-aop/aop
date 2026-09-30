import { useEffect, useMemo, useSyncExternalStore } from "react";
import { listThreadMessages } from "../../api/threads";
import type { ChatState } from "../chat/chat-state";
import { type Conversation, createConversation } from "../chat/conversation";
import { useLiveProjects } from "../ProjectsProvider";

/**
 * One thread's transcript, kept current for as long as the pane is open: fetched when it
 * opens, then followed on the project's stream (messages, and the live text of the reply being
 * written) and fetched again after a resync.
 */
export const useThreadConversation = (
  projectId: string,
  threadId: string,
): { conversation: Conversation; state: ChatState } => {
  const live = useLiveProjects();
  const conversation = useMemo(
    () =>
      createConversation({
        projectId,
        scope: threadId,
        listMessages: () => listThreadMessages(threadId),
        events: live,
      }),
    [projectId, threadId, live],
  );

  useEffect(() => {
    conversation.start();
    return () => conversation.stop();
  }, [conversation]);

  const state = useSyncExternalStore(conversation.subscribe, conversation.getState);
  return { conversation, state };
};
