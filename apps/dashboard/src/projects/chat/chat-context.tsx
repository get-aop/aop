import type { Thread } from "@aop/common";
import { createContext, type ReactNode, useContext, useMemo } from "react";

interface ChatContextValue {
  projectId: string;
  /** Whether the project accepts work: a paused or archived project starts no thread. */
  projectActive: boolean;
  threads: ReadonlyMap<string, Thread>;
  /** False until the project's threads have been fetched: a thread not found then may only not have arrived. */
  threadsLoaded: boolean;
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
  children,
}: {
  projectId: string;
  projectActive: boolean;
  threads: readonly Thread[];
  threadsLoaded: boolean;
  children: ReactNode;
}) => {
  const value = useMemo<ChatContextValue>(
    () => ({
      projectId,
      projectActive,
      threads: new Map(threads.map((thread) => [thread.id, thread])),
      threadsLoaded,
    }),
    [projectId, projectActive, threads, threadsLoaded],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChatContext = (): ChatContextValue => {
  const value = useContext(ChatContext);
  if (!value) throw new Error("Chat blocks must be rendered inside <ChatProvider>");
  return value;
};

/** One thread by id, and whether it could still turn up (the project's threads are still loading). */
export const useChatThread = (
  threadId: string,
): { thread: Thread | undefined; loaded: boolean; projectId: string } => {
  const { threads, threadsLoaded, projectId } = useChatContext();
  return { thread: threads.get(threadId), loaded: threadsLoaded, projectId };
};
