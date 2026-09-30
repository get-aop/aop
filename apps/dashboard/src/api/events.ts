import type { DashboardChatUnreadEvent, SSEChatUnreadEvent, SSEInitEvent } from "@aop/common";
import type { RegisteredRepo } from "./settings";

export type HostEvent =
  | { type: "init"; data: { repos: RegisteredRepo[] } }
  | { type: "repo-removed"; data: { repoId: string } }
  | { type: "data-reset"; data: Record<string, never> }
  | DashboardChatUnreadEvent;

interface HostEventsOptions {
  onEvent: (event: HostEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

const MIN_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;

const EVENT_TYPES = ["init", "repo-removed", "data-reset", "chat-unread"] as const;

export const createHostEventsConnection = (options: HostEventsOptions) => {
  let eventSource: EventSource | null = null;
  let retryCount = 0;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const getRetryDelay = () => {
    const delay = Math.min(MIN_RETRY_DELAY * 2 ** retryCount, MAX_RETRY_DELAY);
    return delay + Math.random() * 1000;
  };

  const connect = () => {
    if (closed) return;

    eventSource = new EventSource("/api/events");

    eventSource.onopen = () => {
      retryCount = 0;
      options.onConnect?.();
    };

    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;
      options.onDisconnect?.();

      if (!closed) {
        const delay = getRetryDelay();
        retryCount++;
        retryTimeout = setTimeout(connect, delay);
      }
    };

    for (const type of EVENT_TYPES) {
      eventSource.addEventListener(type, (e) => {
        const event = parseEvent(type, (e as MessageEvent).data, options.onError);
        if (event) options.onEvent(event);
      });
    }
  };

  const close = () => {
    closed = true;
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };

  connect();

  return { close };
};

const parseEvent = (
  eventType: (typeof EVENT_TYPES)[number],
  data: string,
  onError?: (error: Error) => void,
): HostEvent | null => {
  try {
    const parsed = JSON.parse(data);
    switch (eventType) {
      case "init": {
        const { status } = parsed as SSEInitEvent;
        const repos = status.repos.map(({ id, name, path }) => ({ id, name, path }));
        return { type: "init", data: { repos } };
      }
      case "repo-removed":
        return { type: "repo-removed", data: { repoId: parsed.repoId } };
      case "data-reset":
        return { type: "data-reset", data: {} };
      case "chat-unread": {
        const { sessionId, title, snippet, kind } = parsed as SSEChatUnreadEvent;
        return { type: "chat-unread", data: { sessionId, title, snippet, kind } };
      }
    }
  } catch {
    onError?.(new Error(`Failed to parse SSE event: ${data}`));
    return null;
  }
};
