import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLiveProjects } from "../ProjectsProvider";
import { useChatApi } from "./chat-api";
import { type ChatModel, createProjectChat, type ProjectChat } from "./project-chat";
import { browserSeenStore } from "./seen-store";

/**
 * The coordinator chat of the project on screen. It runs for as long as the project is open,
 * not only while the chat tab is: that is what lets the tab show a reply that arrived while
 * the person was looking at a thread. `enabled` is false for a project that does not exist.
 */
export const useProjectChat = (
  projectId: string,
  enabled: boolean,
): { chat: ProjectChat; model: ChatModel } => {
  const live = useLiveProjects();
  const api = useChatApi();
  const chat = useMemo(
    () => createProjectChat({ projectId, api, events: live, seen: browserSeenStore }),
    [projectId, api, live],
  );

  useEffect(() => {
    if (!enabled) return;
    chat.start();
    return () => chat.stop();
  }, [chat, enabled]);

  const model = useSyncExternalStore(chat.subscribe, chat.getState);
  return { chat, model };
};
