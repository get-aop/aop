import type { Thread, ThreadStatus } from "@aop/common";

// Statuses a thread only reaches once it has finished a piece of work.
const FINISHED: ReadonlySet<ThreadStatus> = new Set(["ready-for-review", "landing", "resolved"]);

/**
 * The Overview's greeting. With a name: "Welcome, Ada." until a thread in the project has
 * finished something, "Welcome back, Ada." after. With no name set, always "Welcome back.".
 * The name is cut to its first word, so "Ada Lovelace" is greeted as "Ada".
 */
export const greetingOf = (displayName: string, threads: readonly Thread[]): string => {
  const firstName = displayName.trim().split(/\s+/)[0];
  if (!firstName) return "Welcome back.";
  const returning = threads.some((thread) => FINISHED.has(thread.status));
  return returning ? `Welcome back, ${firstName}.` : `Welcome, ${firstName}.`;
};
