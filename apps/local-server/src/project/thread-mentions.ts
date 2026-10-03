import type { Thread } from "@aop/common";
import { oneLine } from "./prompt-text.ts";
import { ADDED_BY_AOP } from "./thread-digest.ts";

/**
 * What a thread is told about the other threads a message to it mentions. The person @-mentions a
 * thread as `[its title](thread:<id>)`, which tells a thread nothing it can act on: it has no tools
 * to read another thread. So the message goes with each mentioned thread's branch and pull
 * request, which it can read (git, gh) to see that thread's work.
 */

export const MENTIONS_MAX = 10;
const TITLE_MAX_CHARS = 100;
const DESCRIPTION_MAX_CHARS = 200;
// The id pattern is the one the dashboard renders as a chip (inline-run.ts).
const THREAD_LINK = /\]\(thread:([A-Za-z0-9_-]+)\)/g;

/** The ids of the threads a message links to, first mention first, each once. */
export const mentionedThreadIds = (text: string): string[] => [
  ...new Set(Array.from(text.matchAll(THREAD_LINK), (match) => match[1] ?? "")),
];

/** Lines to add after the message; none when it mentions no thread found. */
export const buildMentionNote = (threads: readonly Thread[]): string[] => {
  if (threads.length === 0) return [];
  return [
    ADDED_BY_AOP,
    "Threads mentioned above, as [title](thread:<id>). They are other agent sessions of this project, each working on its own branch: read their work if it helps, do not change it.",
    ...threads.slice(0, MENTIONS_MAX).map(mentionLine),
  ];
};

const mentionLine = (thread: Thread): string => {
  const pullRequest = thread.artifacts.find((artifact) => artifact.type === "pr");
  const detail = [
    thread.branch ? `branch ${thread.branch}` : "no branch",
    pullRequest
      ? `pull request #${pullRequest.number} (${pullRequest.state}) ${pullRequest.url}`
      : null,
    thread.description ? `asked: ${oneLine(thread.description, DESCRIPTION_MAX_CHARS)}` : null,
  ].filter((part) => part !== null);
  return `- ${thread.id} "${oneLine(thread.title, TITLE_MAX_CHARS)}" [${thread.status}] · ${detail.join(" · ")}`;
};
