import { type Dispatch, type SetStateAction, useCallback, useEffect } from "react";
import { type ChatSessionSummary, markChatSessionRead } from "../../api/client";
import { subscribeChatUnreadSessionIncrement } from "../../hooks/use-chat-unread";

export const useSessionUnreadCounts = (
  activeIdRef: { current: string | null },
  setSessions: Dispatch<SetStateAction<ChatSessionSummary[]>>,
): ((sessionId: string | null) => Promise<void>) => {
  useEffect(
    () =>
      subscribeChatUnreadSessionIncrement((sessionId) => {
        setSessions((current) =>
          incrementSessionUnreadCount(current, sessionId, activeIdRef.current),
        );
      }),
    [activeIdRef, setSessions],
  );

  return useCallback(
    async (sessionId: string | null) => {
      if (!sessionId) return;
      setSessions((current) => clearSessionUnreadCount(current, sessionId));
      try {
        await markChatSessionRead(sessionId);
      } catch {
        // The next list refresh restores the authoritative server count.
      }
    },
    [setSessions],
  );
};

export const clearSessionUnreadCount = (
  sessions: ChatSessionSummary[],
  sessionId: string,
): ChatSessionSummary[] =>
  sessions.map((session) => (session.id === sessionId ? { ...session, unreadCount: 0 } : session));

export const incrementSessionUnreadCount = (
  sessions: ChatSessionSummary[],
  sessionId: string,
  activeSessionId: string | null,
): ChatSessionSummary[] => {
  if (sessionId === activeSessionId) return sessions;
  return sessions.map((session) =>
    session.id === sessionId
      ? { ...session, unreadCount: (session.unreadCount ?? 0) + 1 }
      : session,
  );
};
