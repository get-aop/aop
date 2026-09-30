import { useCallback, useState } from "react";

const storageKey = (threadId: string): string => `aop:pr-bar-hidden:v1:${threadId}`;

const read = (threadId: string): boolean => {
  try {
    return window.localStorage.getItem(storageKey(threadId)) === "1";
  } catch {
    return false;
  }
};

/**
 * Whether the person sent this thread's pull request bar away, which this browser remembers for
 * the thread. A pull request that exists is never hidden: the bar is how it is merged.
 */
export const usePullRequestBarHidden = (threadId: string): [boolean, (hidden: boolean) => void] => {
  const [hidden, setHidden] = useState(() => read(threadId));
  const set = useCallback(
    (next: boolean) => {
      setHidden(next);
      try {
        if (next) window.localStorage.setItem(storageKey(threadId), "1");
        else window.localStorage.removeItem(storageKey(threadId));
      } catch {
        // Storage is blocked: the bar stays away until the thread is opened again.
      }
    },
    [threadId],
  );
  return [hidden, set];
};
