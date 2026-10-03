import { record, type SlackDirectory, text } from "./directory.ts";
import {
  type SlackParams,
  SlackRateLimited,
  type SlackReply,
  type SlackWebApi,
} from "./web-api.ts";

/**
 * Reads what Slack said while the host was not listening: Slack does not replay events missed
 * while no socket was open. Conversations the person is in are read with conversations.history
 * since the last message the feed saw, DMs first, then private and public channels; replies are
 * read for threads the person is part of. Calls are spaced (history is Tier 3, about 50 a minute
 * for an internal app) and a "slow down" is waited out, so a workspace with hundreds of
 * channels is read in the background over a few minutes rather than refused.
 */
export interface CatchUpDeps {
  api: SlackWebApi;
  token: string;
  directory: SlackDirectory;
  /** Handles one message as if the socket had delivered it. */
  handle: (channel: string, message: Record<string, unknown>) => Promise<void>;
  isKnownThread: (channel: string, threadTs: string) => Promise<boolean>;
  /** Threads the person is part of that were active since `since`, whose start may be older. */
  knownThreads: () => Promise<Array<{ conversationId: string; threadId: string }>>;
  stopped: () => boolean;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CatchUpReport {
  /** The `ts` of every message read, so the feed can tell whether its socket missed them. */
  timestamps: string[];
}

const CONVERSATION_ORDER = ["im", "mpim", "private", "public"] as const;
const HISTORY_PAGES = 5;
const KNOWN_THREADS_MAX = 50;
const RATE_LIMIT_RETRIES = 3;

export const catchUp = async (since: string, deps: CatchUpDeps): Promise<CatchUpReport> => {
  const reader = new CatchUpReader(since, deps);
  return reader.run();
};

class CatchUpReader {
  private readonly timestamps: string[] = [];
  private readonly readThreads = new Set<string>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly since: string,
    private readonly deps: CatchUpDeps,
  ) {
    this.sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  }

  async run(): Promise<CatchUpReport> {
    const call: Call = (method, params) => this.call(method, params);
    for (const channel of await listConversations(call, this.deps.directory)) {
      await this.readConversation(channel, call);
    }
    const threads = (await this.deps.knownThreads()).slice(0, KNOWN_THREADS_MAX);
    for (const thread of threads) {
      if (!this.readThreads.has(`${thread.conversationId}:${thread.threadId}`)) {
        await this.readReplies(thread.conversationId, thread.threadId);
      }
    }
    return { timestamps: this.timestamps };
  }

  private async readConversation(channel: string, call: Call): Promise<void> {
    for (const message of await readHistory(call, channel, this.since)) {
      const ts = text(message.ts);
      this.timestamps.push(ts);
      await this.deps.handle(channel, message);
      const latestReply = text(message.latest_reply);
      if (latestReply > this.since && (await this.deps.isKnownThread(channel, ts))) {
        await this.readReplies(channel, ts);
      }
    }
  }

  private async readReplies(channel: string, threadTs: string): Promise<void> {
    this.readThreads.add(`${channel}:${threadTs}`);
    const reply = await this.call("conversations.replies", {
      channel,
      ts: threadTs,
      oldest: this.since,
      limit: 200,
    });
    for (const message of messagesOf(reply)) {
      const ts = text(message.ts);
      if (ts === threadTs || ts <= this.since) continue;
      this.timestamps.push(ts);
      await this.deps.handle(channel, message);
    }
  }

  /** A spaced call; a "slow down" is waited out. Null when Slack refused or the feed stopped. */
  private async call(method: string, params: SlackParams): Promise<SlackReply | null> {
    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES && !this.deps.stopped(); attempt += 1) {
      await this.sleep(this.deps.pauseMs ?? 1_200);
      const outcome = await this.attempt(method, params);
      if (outcome.kind === "done") return outcome.reply;
      await this.sleep(outcome.waitMs);
    }
    return null;
  }

  private async attempt(
    method: string,
    params: SlackParams,
  ): Promise<{ kind: "done"; reply: SlackReply | null } | { kind: "wait"; waitMs: number }> {
    try {
      const reply = await this.deps.api.call(method, this.deps.token, params);
      return { kind: "done", reply: reply.body.ok === true ? reply : null };
    } catch (error) {
      return error instanceof SlackRateLimited
        ? { kind: "wait", waitMs: error.retryAfterMs }
        : { kind: "done", reply: null };
    }
  }
}

type Call = (method: string, params: SlackParams) => Promise<SlackReply | null>;

/** The conversations the person is in, DMs first. */
const listConversations = async (call: Call, directory: SlackDirectory): Promise<string[]> => {
  const found: Array<{ id: string; order: number }> = [];
  let cursor = "";
  do {
    const reply = await call("users.conversations", {
      types: "im,mpim,private_channel,public_channel",
      exclude_archived: true,
      limit: 200,
      cursor: cursor || undefined,
    });
    if (!reply) break;
    for (const channel of Array.isArray(reply.body.channels) ? reply.body.channels : []) {
      const fields = record(channel);
      directory.noteConversation(fields);
      found.push({ id: text(fields.id), order: CONVERSATION_ORDER.indexOf(kindOf(fields)) });
    }
    cursor = text(record(reply.body.response_metadata).next_cursor);
  } while (cursor);
  return found
    .filter((conversation) => conversation.id)
    .sort((a, b) => a.order - b.order)
    .map((conversation) => conversation.id);
};

/** A conversation's messages since `since`, oldest first. */
const readHistory = async (
  call: Call,
  channel: string,
  since: string,
): Promise<Array<Record<string, unknown>>> => {
  const pages: Array<Array<Record<string, unknown>>> = [];
  let cursor = "";
  for (let page = 0; page < HISTORY_PAGES; page += 1) {
    const reply = await call("conversations.history", {
      channel,
      oldest: since,
      limit: 200,
      cursor: cursor || undefined,
    });
    if (!reply) break;
    pages.push(messagesOf(reply));
    cursor = text(record(reply.body.response_metadata).next_cursor);
    if (!cursor) break;
  }
  return pages.flat().sort((a, b) => (text(a.ts) < text(b.ts) ? -1 : 1));
};

const messagesOf = (reply: SlackReply | null): Array<Record<string, unknown>> =>
  reply && Array.isArray(reply.body.messages) ? reply.body.messages.map(record) : [];

const kindOf = (channel: Record<string, unknown>): (typeof CONVERSATION_ORDER)[number] => {
  if (channel.is_im === true) return "im";
  if (channel.is_mpim === true) return "mpim";
  return channel.is_private === true ? "private" : "public";
};
