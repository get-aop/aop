import type { InboxItem, InboxReason, InboxView } from "@aop/common";

/** The Inbox page's words for what it shows. Pure, so the tests read them directly. */

export const VIEW_LABEL: Record<InboxView, string> = {
  "needs-me": "Needs me",
  mentions: "Mentions",
  dms: "DMs",
  threads: "Threads",
  snoozed: "Snoozed",
  done: "Done",
};

/** The tag on an item: one, the strongest reason it is here. */
export const REASON_TAG: Record<InboxReason, string> = {
  mention: "@you",
  dm: "DM",
  "thread-reply": "Reply in your thread",
  group: "@group",
  broadcast: "@here",
  keyword: "Keyword",
};

const REASON_SENTENCE: Record<InboxReason, string> = {
  mention: "someone mentioned you directly",
  dm: "it is a direct message to you",
  "thread-reply": "someone replied in a thread you are part of",
  group: "it mentions a group you are in",
  broadcast: "it was sent to everyone in the channel (@here or @channel)",
  keyword: "it has one of your keywords",
};

export const whyHere = (item: InboxItem): string => `Here because ${REASON_SENTENCE[item.reason]}`;

/** Where the message is: `#infra · thread`, `DM`, or `Group DM · Ana, Jonas`. */
export const whereOf = (item: Pick<InboxItem, "conversation" | "threadId">): string => {
  const { conversation } = item;
  const base =
    conversation.kind === "dm"
      ? "DM"
      : conversation.kind === "group-dm"
        ? `Group DM · ${conversation.name}`
        : `#${conversation.name}`;
  return item.threadId ? `${base} · thread` : base;
};

/** "4m", "3h", "Yesterday", "Sep 28": short enough for a list row. */
export const relativeTime = (iso: string, now: number): string => {
  const at = Date.parse(iso);
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  if (hours < 48) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "?";

export interface SnoozeChoice {
  id: string;
  label: string;
  until: Date;
}

/** One hour, this afternoon (when it is still morning), tomorrow 09:00 and next Monday 09:00. */
export const snoozeChoices = (now: Date): SnoozeChoice[] => {
  const at = (days: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date;
  };
  const choices: SnoozeChoice[] = [
    { id: "hour", label: "1 hour", until: new Date(now.getTime() + 60 * 60 * 1000) },
  ];
  if (now.getHours() < 13)
    choices.push({ id: "afternoon", label: "This afternoon (14:00)", until: at(0, 14) });
  choices.push({ id: "tomorrow", label: "Tomorrow 09:00", until: at(1, 9) });
  const toMonday = (8 - now.getDay()) % 7 || 7;
  choices.push({ id: "monday", label: "Next Monday 09:00", until: at(toMonday, 9) });
  return choices;
};

/** The parts of a text that are links, so they render as links and the rest as text. */
export const splitLinks = (text: string): Array<{ text: string; url: boolean; start: number }> => {
  const parts: Array<{ text: string; url: boolean; start: number }> = [];
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s)<>]+/g)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), url: false, start: last });
    parts.push({ text: match[0], url: true, start: at });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), url: false, start: last });
  return parts;
};

/** What went wrong, in words, whatever was thrown. */
export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
