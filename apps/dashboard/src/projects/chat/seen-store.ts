import type { SeenStore } from "./project-chat";

const SEEN_STORAGE_KEY = "aop:coordinator-seen:v1";

type SeenByProject = Record<string, string>;

/**
 * Where this browser remembers how far it has read each project's coordinator chat. It is a
 * per-device choice kept in local storage: the host stores no read state for the chat.
 */
export const browserSeenStore: SeenStore = {
  get: (projectId) => read()[projectId] ?? null,
  set: (projectId, seenAt) => write({ ...read(), [projectId]: seenAt }),
};

const read = (): SeenByProject => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SEEN_STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as SeenByProject)
      : {};
  } catch {
    return {};
  }
};

const write = (seen: SeenByProject): void => {
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // Storage full or blocked: the chat then counts everything unseen on the next visit, which is safe.
  }
};
