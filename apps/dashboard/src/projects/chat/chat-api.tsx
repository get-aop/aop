import type { MessagePage, Thread, UserMessage } from "@aop/common";
import { createContext, useContext } from "react";
import {
  interruptForMessage,
  listCoordinatorMessages,
  type SendOptions,
  sendCoordinatorMessage,
  skipSuggestion,
  startSuggestion,
  unskipSuggestion,
} from "../../api/project-chat";

/** What the chat asks of the host. A test brings its own through `ChatApiProvider`. */
export interface ChatApi {
  /** The latest page of the coordinator chat, or the one before message `before`. */
  listMessages: (projectId: string, before?: string) => Promise<MessagePage>;
  /** `images` are ids of images uploaded to the project, in order. */
  sendMessage: (
    projectId: string,
    text: string,
    images?: readonly string[],
    options?: SendOptions,
  ) => Promise<UserMessage>;
  /**
   * The answers to a proposal of the coordinator, given by the message and the suggestion. The
   * host records them and publishes the message again, so the page shows an answer when the
   * stream delivers it, on every device alike.
   */
  startSuggestion: (projectId: string, messageId: string, suggestionId: string) => Promise<Thread>;
  skipSuggestion: (projectId: string, messageId: string, suggestionId: string) => Promise<void>;
  unskipSuggestion: (projectId: string, messageId: string, suggestionId: string) => Promise<void>;
  /** "Interrupt now" on a message that waits for the agent's current step or turn to end. */
  interruptForMessage: (
    projectId: string,
    messageId: string,
  ) => Promise<"interrupted" | "delivered">;
}

export const browserChatApi: ChatApi = {
  listMessages: listCoordinatorMessages,
  sendMessage: sendCoordinatorMessage,
  startSuggestion,
  skipSuggestion,
  unskipSuggestion,
  interruptForMessage,
};

const ChatApiContext = createContext<ChatApi>(browserChatApi);

export const ChatApiProvider = ChatApiContext.Provider;

export const useChatApi = (): ChatApi => useContext(ChatApiContext);
