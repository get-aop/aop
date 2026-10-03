import type { InboxConversationKind } from "@aop/common";
import type { SlackWebApi } from "./web-api.ts";

/**
 * Names for what Slack messages carry as ids: people (`users.info`, kept a day), conversations
 * (`conversations.info`, kept an hour) and the groups the person is in (`usergroups.list`, read
 * again every hour). A lookup Slack refuses falls back to the id, so a message is never dropped
 * for want of a name.
 */
export interface SlackPerson {
  name: string;
  avatarUrl: string | null;
}

export interface SlackConversationInfo {
  name: string;
  kind: InboxConversationKind;
}

export interface SlackDirectory {
  person: (userId: string) => Promise<SlackPerson>;
  /** A person's name if it was already looked up, for rendering without waiting. */
  knownName: (userId: string) => string | null;
  conversation: (channelId: string) => Promise<SlackConversationInfo>;
  /** Primes the cache from a conversation object Slack already returned (users.conversations). */
  noteConversation: (channel: Record<string, unknown>) => void;
  myGroups: () => Promise<Set<string>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const createSlackDirectory = (deps: {
  api: SlackWebApi;
  token: string;
  me: string;
  now?: () => number;
}): SlackDirectory => {
  const now = deps.now ?? Date.now;
  const people = new Cache<SlackPerson>(DAY_MS, now);
  const conversations = new Cache<SlackConversationInfo>(HOUR_MS, now);
  let groups: { ids: Set<string>; at: number } | null = null;

  const person = (userId: string): Promise<SlackPerson> =>
    people.get(userId, async () => {
      const reply = await deps.api.call("users.info", deps.token, { user: userId });
      const user = record(reply.body.user);
      const profile = record(user.profile);
      const name =
        text(profile.display_name) || text(profile.real_name) || text(user.name) || userId;
      return { name, avatarUrl: text(profile.image_72) || text(profile.image_48) || null };
    });

  const describe = async (channel: Record<string, unknown>): Promise<SlackConversationInfo> => {
    if (channel.is_im === true) {
      const other = text(channel.user);
      return { kind: "dm", name: other ? (await person(other)).name : "Direct message" };
    }
    if (channel.is_mpim === true) return { kind: "group-dm", name: groupDmName(channel) };
    return { kind: "channel", name: text(channel.name) || text(channel.id) };
  };

  return {
    person,
    knownName: (userId) => people.peek(userId)?.name ?? null,
    conversation: (channelId) =>
      conversations.get(channelId, async () => {
        const reply = await deps.api.call("conversations.info", deps.token, {
          channel: channelId,
        });
        if (reply.body.ok !== true) return { kind: kindFromId(channelId), name: channelId };
        return describe(record(reply.body.channel));
      }),
    noteConversation: (channel) => {
      const id = text(channel.id);
      if (id) conversations.get(id, () => describe(channel)).catch(() => undefined);
    },
    myGroups: async () => {
      if (groups && now() - groups.at < HOUR_MS) return groups.ids;
      const reply = await deps.api
        .call("usergroups.list", deps.token, { include_users: true })
        .catch(() => null);
      const list = Array.isArray(reply?.body.usergroups) ? reply.body.usergroups : [];
      const ids = new Set(
        list
          .map(record)
          .filter((group) => Array.isArray(group.users) && group.users.includes(deps.me))
          .map((group) => text(group.id)),
      );
      groups = { ids, at: now() };
      return ids;
    },
  };
};

/** A group DM's Slack name is `mpdm-ana--jonas--me-1`; it reads better as the people in it. */
const groupDmName = (channel: Record<string, unknown>): string => {
  const purpose = text(record(channel.purpose).value);
  if (purpose) return purpose.replace(/^Group messaging with:\s*/i, "");
  const name = text(channel.name)
    .replace(/^mpdm-/, "")
    .replace(/-\d+$/, "");
  return name ? name.split("--").join(", ") : "Group DM";
};

const kindFromId = (id: string): InboxConversationKind => (id.startsWith("D") ? "dm" : "channel");

class Cache<T> {
  private readonly entries = new Map<string, { value: Promise<T>; at: number }>();
  private readonly settled = new Map<string, T>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && this.now() - entry.at < this.ttlMs) return entry.value;
    const value = load().then((loaded) => {
      this.settled.set(key, loaded);
      return loaded;
    });
    // A failed lookup is forgotten at once, so the next message asks again.
    value.catch(() => this.entries.delete(key));
    this.entries.set(key, { value, at: this.now() });
    return value;
  }

  peek(key: string): T | undefined {
    return this.settled.get(key);
  }
}

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const text = (value: unknown): string => (typeof value === "string" ? value : "");
