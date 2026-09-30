import type { ChatApi } from "../chat/chat-api";
import { hostError, json, mockHost } from "../thread/test-utils";

/**
 * The chat asks the host for its messages when a project opens; tests about the page around
 * it never want an answer, so the chat stays loading.
 */
export const silentChatHost: ChatApi = {
  listMessages: () => new Promise(() => {}),
  sendMessage: () => new Promise(() => {}),
  startSuggestion: () => new Promise(() => {}),
  skipSuggestion: () => new Promise(() => {}),
  unskipSuggestion: () => new Promise(() => {}),
};

/** A host that answers what a thread's pane asks when it opens, with nothing to show. */
export const mockEmptyThreadHost = (): ReturnType<typeof mockHost> => {
  const host = mockHost();
  host.respondWith(({ url }) => {
    if (url.endsWith("/messages")) return json({ messages: [] });
    if (url.endsWith("/activity")) return json({ turns: [] });
    if (url.endsWith("/status")) return json({ repos: [] });
    if (url.endsWith("/diff")) {
      return json({ defaultBranch: "main", files: [], perFileLineCap: 2000, summaryOnly: true });
    }
    return hostError(404, "NOT_FOUND", "not found");
  });
  return host;
};
