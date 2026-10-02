import type { LibraryUsedIn } from "@aop/common";
import { toast } from "sonner";
import { navigate, threadPath } from "../../shell/router";

const FIND_FOR_MS = 4_000;

/**
 * Opens the chat an item came from and brings its message into view: a thread's in the panel,
 * the coordinator's beside it (`revealChat` uncovers it where the panel covers the chat). The
 * message is found by its row once the chat has drawn it; one further back than the chat has
 * loaded is not, and the person is told to scroll up for it.
 */
export const showLibrarySource = (
  projectId: string,
  usedIn: LibraryUsedIn,
  revealChat: () => void,
): void => {
  if (usedIn.threadId) navigate(threadPath(projectId, usedIn.threadId));
  else revealChat();
  if (!usedIn.messageId) return;
  const scope = usedIn.threadId
    ? '[data-testid="threads-panel"]'
    : '[data-testid="coordinator-chat-pane"]';
  void findRow(`${scope} [data-message-id="${CSS.escape(usedIn.messageId)}"]`).then((row) => {
    if (!row) {
      toast.info("That message is further back in the chat. Scroll up to load it.");
      return;
    }
    row.scrollIntoView({ block: "center" });
    row.animate?.(
      [{ backgroundColor: "rgb(91 157 255 / 0.18)" }, { backgroundColor: "transparent" }],
      { duration: 2_000, easing: "ease-out" },
    );
  });
};

const findRow = async (selector: string): Promise<HTMLElement | null> => {
  const deadline = Date.now() + FIND_FOR_MS;
  while (Date.now() < deadline) {
    const row = document.querySelector<HTMLElement>(selector);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
};
