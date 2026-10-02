import { getThreadProgress, type Thread } from "@aop/common";
import { oneLine } from "./prompt-text.ts";

/**
 * The coordinator's list of its threads, added to each message it is sent. It changes whenever a
 * thread does, so it goes in the message and not in the system prompt, whose text must stay the
 * same from turn to turn (see system-prompt.ts).
 */

export const THREAD_DIGEST_MAX = 20;
const STATUS_LINE_MAX_CHARS = 120;
const TITLE_MAX_CHARS = 100;
const MARK = "--- added by AOP, not written by the person ---";

export const buildThreadDigest = (threads: readonly Thread[]): string[] => {
  if (threads.length === 0) return [MARK, "This project has no threads yet."];
  const shown = threads.slice(0, THREAD_DIGEST_MAX);
  const more = threads.length - shown.length;
  return [
    MARK,
    "Threads of this project, latest activity first:",
    ...shown.map(digestLine),
    ...(more > 0 ? [`(${more} older threads not shown; use thread_list)`] : []),
  ];
};

const digestLine = (thread: Thread): string => {
  const progress = getThreadProgress(thread);
  const detail = [
    progress ? `${progress.done}/${progress.total}` : null,
    thread.liveStatusLine ? oneLine(thread.liveStatusLine, STATUS_LINE_MAX_CHARS) : null,
    ...attentionNotes(thread),
  ].filter((part) => part !== null);
  const title = oneLine(thread.title, TITLE_MAX_CHARS);
  return `- ${thread.id} "${title}" [${thread.status}]${detail.length ? ` ${detail.join(" · ")}` : ""}`;
};

// What a working thread needs the person to know while its turn goes on.
const attentionNotes = (thread: Thread): string[] => {
  if (thread.status !== "working") return [];
  return [
    ...(thread.waitingOn
      ? [`waiting on the person: ${oneLine(thread.waitingOn.reason, STATUS_LINE_MAX_CHARS)}`]
      : []),
    ...(thread.degraded ? ["lost its AOP tools"] : []),
  ];
};
