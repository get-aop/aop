import type { Message, SuggestedThread, Thread, UserMessage } from "@aop/common";
import { createContext, useContext } from "react";
import {
  listCoordinatorMessages,
  sendCoordinatorMessage,
  startSuggestedThread,
} from "../../api/project-chat";

/** What the chat asks of the host. A test brings its own through `ChatApiProvider`. */
export interface ChatApi {
  listMessages: (projectId: string) => Promise<Message[]>;
  sendMessage: (projectId: string, text: string) => Promise<UserMessage>;
  /** Starts the thread a suggestion proposes. */
  startThread: (projectId: string, suggestion: SuggestedThread) => Promise<Thread>;
}

export const browserChatApi: ChatApi = {
  listMessages: listCoordinatorMessages,
  sendMessage: sendCoordinatorMessage,
  startThread: startSuggestedThread,
};

const ChatApiContext = createContext<ChatApi>(browserChatApi);

export const ChatApiProvider = ChatApiContext.Provider;

export const useChatApi = (): ChatApi => useContext(ChatApiContext);
