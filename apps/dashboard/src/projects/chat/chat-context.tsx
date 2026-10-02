import type { Thread } from "@aop/common";
import { createContext, type ReactNode, useContext, useMemo } from "react";

interface ChatContextValue {
  projectId: string;
  /** Whether the project accepts work: a paused or archived project starts no thread. */
  projectActive: boolean;
  threads: ReadonlyMap<string, Thread>;
  /** False until the project's threads have been fetched: a thread not found then may only not have arrived. */
  threadsLoaded: boolean;
  /** Why the last fetch of the threads failed; null while it has not failed. */
  threadsError: string | null;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * What the blocks of a conversation need from their project: its threads, so that a card or
 * chip shows the thread as it is now and not as it was when the message was written.
 */
export const ChatProvider = ({
  projectId,
  projectActive,
  threads,
  threadsLoaded,
  threadsError,
  children,
}: {
  projectId: string;
  projectActive: boolean;
  threads: readonly Thread[];
  threadsLoaded: boolean;
  threadsError: string | null;
  children: ReactNode;
}) => {
  const value = useMemo<ChatContextValue>(
    () => ({
      projectId,
      projectActive,
      threads: new Map(threads.map((thread) => [thread.id, thread])),
      threadsLoaded,
      threadsError,
    }),
    [projectId, projectActive, threads, threadsLoaded, threadsError],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChatContext = (): ChatContextValue => {
  const value = useContext(ChatContext);
  if (!value) throw new Error("Chat blocks must be rendered inside <ChatProvider>");
  return value;
};

/** The chat's context where there may be none (markdown drawn on its own, in a test). */
export const useOptionalChatContext = (): ChatContextValue | null => useContext(ChatContext);

/**
 * One thread by id, whether it could still turn up (the project's threads are still loading),
 * and why they did not load when fetching them failed.
 */
export const useChatThread = (
  threadId: string,
): { thread: Thread | undefined; loaded: boolean; error: string | null; projectId: string } => {
  const { threads, threadsLoaded, threadsError, projectId } = useChatContext();
  return { thread: threads.get(threadId), loaded: threadsLoaded, error: threadsError, projectId };
};
