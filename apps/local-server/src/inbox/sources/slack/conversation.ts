import type {
  InboxContext,
  InboxContextMessage,
  InboxItem,
  InboxReplyInput,
  SlackChannel,
} from "@aop/common";
import { record, text } from "./directory.ts";
import { slackTime } from "./events.ts";
import type { SlackFeed } from "./feed.ts";
import { renderMrkdwn, userIdsIn } from "./mrkdwn.ts";
import { SlackRateLimited, SlackUnreachable, slackError } from "./web-api.ts";

/**
 * What the Inbox page does in Slack, through an item's workspace feed: read the context when an
 * item is opened (never stored), reply as the person, post a note in a thread, and the person's
 * presence and Do Not Disturb for notifications.
 */
export type SlackActionResult<T> = ({ ok: true } & T) | { ok: false; message: string };

/** Shown when an item is opened: the thread's parent and its last few replies. */
export const CONTEXT_RECENT = 3;
const CONTEXT_ALL = 200;

export const readContext = async (
  feed: SlackFeed,
  item: InboxItem,
  all: boolean,
  sentFrom: (messageIds: readonly string[]) => Promise<Set<string>>,
): Promise<SlackActionResult<{ context: InboxContext }>> => {
  const channel = item.conversation.id;
  const threadTs = item.threadId ?? (item.conversation.kind === "channel" ? item.messageId : null);
  const reply = await guard(() =>
    threadTs
      ? call(feed, "conversations.replies", { channel, ts: threadTs, limit: 200 })
      : call(feed, "conversations.history", {
          channel,
          latest: item.messageId,
          inclusive: true,
          limit: all ? CONTEXT_ALL : CONTEXT_RECENT + 1,
        }),
  );
  if (!reply.ok) return reply;
  const raw = Array.isArray(reply.body.messages) ? reply.body.messages.map(record) : [];
  const ordered = [...raw].sort((a, b) => (text(a.ts) < text(b.ts) ? -1 : 1));
  const fromAop = await sentFrom(ordered.map((message) => text(message.ts)));
  const messages = await Promise.all(
    ordered.map((message) => contextMessage(feed, message, fromAop)),
  );
  if (!threadTs) return { ok: true, context: { parent: null, messages, earlier: 0 } };
  const [parent = null, ...replies] = messages;
  const shown = all ? replies : replies.slice(-CONTEXT_RECENT);
  return {
    ok: true,
    context: { parent, messages: shown, earlier: replies.length - shown.length },
  };
};

/** Posts the person's reply, as them, in the item's thread (or its DM). Only their click sends. */
export const postReply = async (
  feed: SlackFeed,
  item: InboxItem,
  input: InboxReplyInput,
): Promise<SlackActionResult<{ message: InboxContextMessage }>> => {
  const threadTs = item.threadId ?? (item.conversation.kind === "channel" ? item.messageId : null);
  const reply = await guard(() =>
    call(feed, "chat.postMessage", {
      channel: item.conversation.id,
      text: input.text,
      thread_ts: threadTs ?? undefined,
      reply_broadcast: threadTs && input.broadcast ? true : undefined,
    }),
  );
  if (!reply.ok) return { ok: false, message: replyError(reply.message, item) };
  const message = record(reply.body.message);
  const ts = text(reply.body.ts) || text(message.ts);
  return {
    ok: true,
    message: await contextMessage(
      feed,
      { ...message, ts, user: feed.connection.userId },
      new Set([ts]),
    ),
  };
};

/** A fixed note in a Slack thread, as the person (the post-back). */
export const postNote = async (
  feed: SlackFeed,
  channel: string,
  threadTs: string | null,
  note: string,
): Promise<SlackActionResult<{ ts: string }>> => {
  const reply = await guard(() =>
    call(feed, "chat.postMessage", { channel, text: note, thread_ts: threadTs ?? undefined }),
  );
  return reply.ok ? { ok: true, ts: text(reply.body.ts) } : reply;
};

/** Whether Slack shows the person away, and whether Do Not Disturb is on now. */
export const readAvailability = async (
  feed: SlackFeed,
  nowSeconds: number,
): Promise<{ away: boolean; doNotDisturb: boolean }> => {
  const user = feed.connection.userId;
  const [presence, dnd] = await Promise.all([
    call(feed, "users.getPresence", { user }).catch(() => null),
    call(feed, "dnd.info", { user }).catch(() => null),
  ]);
  const body = dnd?.body ?? {};
  const scheduled =
    body.dnd_enabled === true &&
    Number(body.next_dnd_start_ts) <= nowSeconds &&
    nowSeconds < Number(body.next_dnd_end_ts);
  return {
    away: presence?.body.presence === "away",
    doNotDisturb: body.snooze_enabled === true || scheduled,
  };
};

/** The channels the person is in, for the rules' channel table. */
export const listChannels = async (
  feed: SlackFeed,
): Promise<SlackActionResult<{ channels: SlackChannel[] }>> => {
  const channels: SlackChannel[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page += 1) {
    const reply = await guard(() =>
      call(feed, "users.conversations", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor: cursor || undefined,
      }),
    );
    if (!reply.ok) return reply;
    for (const channel of Array.isArray(reply.body.channels) ? reply.body.channels : []) {
      const fields = record(channel);
      channels.push({
        id: text(fields.id),
        name: text(fields.name),
        private: fields.is_private === true,
      });
    }
    cursor = text(record(reply.body.response_metadata).next_cursor);
    if (!cursor) break;
  }
  return { ok: true, channels: channels.sort((a, b) => a.name.localeCompare(b.name)) };
};

const call = (
  feed: SlackFeed,
  method: string,
  params: Record<string, string | number | boolean | undefined>,
) => feed.api.call(method, feed.connection.userToken, params);

/** A Slack call as a result: refusals, slow-downs and an unreachable Slack become messages. */
const guard = async (
  run: () => Promise<{ body: Record<string, unknown> }>,
): Promise<SlackActionResult<{ body: Record<string, unknown> }>> => {
  try {
    const reply = await run();
    const error = slackError({ body: reply.body, scopes: null });
    return error ? { ok: false, message: error } : { ok: true, body: reply.body };
  } catch (error) {
    if (error instanceof SlackRateLimited) {
      return {
        ok: false,
        message: `Slack asked to slow down: try again in ${Math.ceil(error.retryAfterMs / 1000)} s`,
      };
    }
    if (error instanceof SlackUnreachable) return { ok: false, message: error.message };
    throw error;
  }
};

const replyError = (code: string, item: InboxItem): string => {
  const where = item.conversation.kind === "channel" ? `#${item.conversation.name}` : "this DM";
  switch (code) {
    case "not_in_channel":
      return `You are not in ${where} any more, so Slack refused the reply.`;
    case "is_archived":
      return `${where} is archived.`;
    case "channel_not_found":
      return `Slack cannot find ${where}.`;
    case "msg_too_long":
      return "The reply is too long for Slack.";
    case "missing_scope":
      return "Your Slack app lacks chat:write: add it under User Token Scopes and reinstall.";
    default:
      return code.includes(" ") ? code : `Slack refused the reply (${code}).`;
  }
};

const contextMessage = async (
  feed: SlackFeed,
  message: Record<string, unknown>,
  fromAop: Set<string>,
): Promise<InboxContextMessage> => {
  const userId = text(message.user);
  const raw = text(message.text);
  await Promise.all(userIdsIn(raw).map((id) => feed.directory.person(id).catch(() => null)));
  const author = userId
    ? await feed.directory.person(userId).catch(() => ({ name: userId, avatarUrl: null }))
    : { name: text(message.username) || "A Slack app", avatarUrl: null };
  const ts = text(message.ts);
  return {
    id: ts,
    author: { id: userId || text(message.bot_id), ...author },
    text: renderMrkdwn(raw, (id) => feed.directory.knownName(id)),
    sentAt: slackTime(ts),
    fromMe: userId === feed.connection.userId,
    fromAop: fromAop.has(ts),
  };
};
