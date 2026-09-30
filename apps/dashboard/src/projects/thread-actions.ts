import type { Thread } from "@aop/common";
import { toast } from "sonner";
import {
  deleteThread,
  replyToThread,
  resolveThread,
  resumeThread,
  steerThread,
  stopThread,
} from "../api/threads";
import { requestConfirmation } from "../components/ConfirmationHost";
import { navigate, parseRoute, projectPath } from "../shell/router";
import type { SendResult } from "./chat/project-chat";

/**
 * What a person can do to one thread. None of them sets the thread's state: the host answers
 * by publishing the thread on the project's stream, and the page follows that. A failure
 * reaches the person as a toast, or, for a message, as the reason its composer shows.
 */
export interface ThreadActions {
  /** Ends the running turn, or the wait for a slot or a reset; the thread goes idle. */
  stop: (thread: Thread) => Promise<void>;
  /** Ends a rate-limited thread's wait now. */
  resume: (thread: Thread) => Promise<void>;
  resolve: (thread: Thread) => Promise<void>;
  /** Asks first; deletes the thread with its worktree and branch, and leaves it if it is open. */
  remove: (thread: Thread) => Promise<void>;
  steer: (thread: Thread, text: string) => Promise<SendResult>;
  /** Answers the question a thread is waiting on. */
  reply: (thread: Thread, text: string) => Promise<SendResult>;
}

export const threadActions: ThreadActions = {
  stop: (thread) => attempt(() => stopThread(thread.id)),
  resume: (thread) => attempt(() => resumeThread(thread.id)),
  resolve: (thread) => attempt(() => resolveThread(thread.id)),
  remove: async (thread) => {
    const confirmed = await requestConfirmation({
      title: `Delete “${thread.title}”?`,
      message:
        "The thread, its transcript, its worktree and its branch are deleted for good. A pull request it opened stays open on GitHub. This cannot be undone.",
      confirmLabel: "Delete thread",
      destructive: true,
    });
    if (!confirmed) return;
    await attempt(async () => {
      await deleteThread(thread.id);
      const current = parseRoute(window.location.pathname);
      if (current?.name === "thread" && current.threadId === thread.id) {
        navigate(projectPath(thread.projectId));
      }
    });
  },
  steer: (thread, text) => send(() => steerThread(thread.id, text)),
  reply: (thread, text) => send(() => replyToThread(thread.id, text)),
};

const attempt = async (run: () => Promise<unknown>): Promise<void> => {
  try {
    await run();
  } catch (error) {
    toast.error(describe(error));
  }
};

const send = async (run: () => Promise<unknown>): Promise<SendResult> => {
  try {
    await run();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
};

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong";
