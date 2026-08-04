import { useEffect, useRef } from "react";
import { storeActiveSessionId } from "../views/sessions/sessions-page-helpers";

/**
 * Cross-route request to open a chat session. Notifications write here;
 * SessionsPage consumes once so remounts never replay a stale request.
 */
let request: { sessionId: string; token: number } | null = null;
let token = 0;
const listeners = new Set<() => void>();

export const requestOpenSession = (sessionId: string): void => {
  storeActiveSessionId(sessionId);
  token += 1;
  request = { sessionId, token };
  for (const listener of listeners) listener();
};

export const peekOpenSessionRequest = (): { sessionId: string; token: number } | null => request;

/** Take and clear the pending request. Returns null when already consumed. */
export const consumeOpenSessionRequest = (): string | null => {
  if (!request) return null;
  const sessionId = request.sessionId;
  request = null;
  for (const listener of listeners) listener();
  return sessionId;
};

export const resetOpenSessionRequestStore = (): void => {
  request = null;
  token = 0;
  for (const listener of listeners) listener();
};

export const useOpenSessionRequest = (onOpen: (sessionId: string) => void): void => {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const consume = () => {
      const sessionId = consumeOpenSessionRequest();
      if (!sessionId) return;
      onOpenRef.current(sessionId);
    };
    consume();
    listeners.add(consume);
    return () => {
      listeners.delete(consume);
    };
  }, []);
};
