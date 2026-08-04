import { sanitizeSessionId } from "../session-id";
import { parseRawJsonlContent } from "./parser";
import type { RawProviderEvent } from "./types";

export const extractRuntimeSessionIdFromRawJsonl = (content: string): string | null => {
  const entries = parseRawJsonlContent(content).entries;
  for (let index = entries.length - 1; index >= 0; index--) {
    const event = entries[index]?.event;
    const sessionId = event ? runtimeSessionIdFromEvent(event) : null;
    if (sessionId) return sessionId;
  }
  return null;
};

const runtimeSessionIdFromEvent = (event: RawProviderEvent): string | null => {
  const direct =
    event.session_id ??
    event.sessionId ??
    event.sessionID ??
    event.thread_id ??
    event.threadId ??
    event.threadID;
  if (typeof direct === "string") return sanitizeSessionId(direct) ?? null;
  if (typeof event.id !== "string" || typeof event.type !== "string") return null;
  return /session|thread/i.test(event.type) ? (sanitizeSessionId(event.id) ?? null) : null;
};
