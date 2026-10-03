import type {
  InboxItem,
  InboxNotification,
  InboxNotificationsPage,
  InboxNotifyMode,
} from "@aop/common";

/**
 * Which new items deserve a desktop notification (decision D6). Off by default: Slack already
 * notifies on mentions and DMs. "Only when I'm away from Slack" covers DMs and direct mentions
 * while Slack shows the person away; "Everything" covers every new item. Slack's Do Not Disturb
 * silences both. The host only decides and queues them; the desktop app reads the queue and shows
 * them, so no client opens one more stream.
 */
export interface InboxNotifier {
  /** A live message made or reopened this item. */
  consider: (item: InboxItem) => Promise<void>;
  /** What was queued after `after`; without it, only the cursor to start from. */
  page: (after: number | null) => InboxNotificationsPage;
}

export interface InboxNotifierDeps {
  modeFor: (sourceId: string) => Promise<InboxNotifyMode>;
  availability: (sourceId: string) => Promise<{ away: boolean; doNotDisturb: boolean }>;
  now?: () => number;
}

const KEEP = 100;
/** Older than this, a notification is history: a client that slept does not get a burst. */
const FRESH_MS = 2 * 60 * 1000;
const BODY_MAX = 180;

export const createInboxNotifier = (deps: InboxNotifierDeps): InboxNotifier => {
  const now = deps.now ?? Date.now;
  const queue: Array<InboxNotification & { at: number }> = [];
  let seq = 0;

  return {
    consider: async (item) => {
      if (!(await deserves(item, deps))) return;
      seq += 1;
      queue.push({ seq, itemId: item.id, title: titleOf(item), body: bodyOf(item), at: now() });
      if (queue.length > KEEP) queue.shift();
    },
    page: (after) => {
      if (after === null) return { cursor: seq, notifications: [] };
      const fresh = now() - FRESH_MS;
      return {
        cursor: seq,
        notifications: queue
          .filter((entry) => entry.seq > after && entry.at >= fresh)
          .map(({ at: _at, ...notification }) => notification),
      };
    },
  };
};

const deserves = async (item: InboxItem, deps: InboxNotifierDeps): Promise<boolean> => {
  const mode = await deps.modeFor(item.sourceId);
  if (mode === "off") return false;
  const direct = item.reason === "mention" || item.reason === "dm";
  if (mode === "away" && !direct) return false;
  const availability = await deps.availability(item.sourceId);
  if (availability.doNotDisturb) return false;
  return mode === "all" || availability.away;
};

const titleOf = (item: InboxItem): string => {
  if (item.conversation.kind === "dm") return item.author.name;
  if (item.conversation.kind === "group-dm") return `${item.author.name} (group DM)`;
  return `${item.author.name} in #${item.conversation.name}`;
};

const bodyOf = (item: InboxItem): string =>
  item.text.length > BODY_MAX ? `${item.text.slice(0, BODY_MAX - 1)}…` : item.text;
