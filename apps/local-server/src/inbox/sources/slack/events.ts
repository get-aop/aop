import type { IncomingMessage } from "../../matcher.ts";
import { record, type SlackDirectory, type SlackPerson, text } from "./directory.ts";
import { mentionFacts, renderMrkdwn } from "./mrkdwn.ts";

/**
 * A Slack message event as a change to the Inbox: a message (new, from the socket or a catch-up
 * read), an edit, or a delete. Thread replies are plain messages whose `thread_ts` differs from
 * their `ts`; edits come as `message_changed` and deletes as `message_deleted`. Joins, leaves and
 * other housekeeping subtypes change nothing.
 * https://docs.slack.dev/reference/events/message
 */
export type SlackChange =
  | { kind: "message"; message: IncomingMessage }
  | { kind: "edit"; conversationId: string; messageId: string; text: string }
  | { kind: "delete"; conversationId: string; messageId: string };

export interface SlackEventContext {
  sourceId: string;
  me: string;
  /** `https://acme.slack.com/`, for permalinks built without asking Slack. */
  teamUrl: string;
  directory: SlackDirectory;
}

/** Subtypes that are someone saying something; the rest is housekeeping. */
const SPOKEN_SUBTYPES = new Set([
  "",
  "thread_broadcast",
  "file_share",
  "bot_message",
  "me_message",
]);

export const slackChange = async (
  event: Record<string, unknown>,
  context: SlackEventContext,
): Promise<SlackChange | null> => {
  if (event.type !== "message") return null;
  const channel = text(event.channel);
  if (!channel) return null;
  const subtype = text(event.subtype);
  if (subtype === "message_deleted") {
    const messageId = text(event.deleted_ts);
    return messageId ? { kind: "delete", conversationId: channel, messageId } : null;
  }
  if (subtype === "message_changed") {
    const changed = record(event.message);
    const messageId = text(changed.ts);
    if (!messageId) return null;
    return {
      kind: "edit",
      conversationId: channel,
      messageId,
      text: await renderText(changed, context),
    };
  }
  if (!SPOKEN_SUBTYPES.has(subtype)) return null;
  return { kind: "message", message: await incomingMessage(channel, event, context) };
};

/** A spoken message as the facts the Inbox's rules read. */
export const incomingMessage = async (
  channel: string,
  message: Record<string, unknown>,
  context: SlackEventContext,
): Promise<IncomingMessage> => {
  const ts = text(message.ts);
  const threadTs = text(message.thread_ts);
  const threadId = threadTs && threadTs !== ts ? threadTs : null;
  const userId = text(message.user);
  const facts = mentionFacts(text(message.text));
  const [conversation, author, groups, rendered] = await Promise.all([
    context.directory
      .conversation(channel)
      .catch(() => ({ name: channel, kind: channel.startsWith("D") ? "dm" : "channel" }) as const),
    authorOf(message, context),
    facts.groups.length > 0 ? context.directory.myGroups() : Promise.resolve(new Set<string>()),
    renderText(message, context),
  ]);
  return {
    sourceId: context.sourceId,
    messageId: ts,
    conversation: { id: channel, ...conversation },
    threadId,
    author: { id: userId || text(message.bot_id) || "unknown", ...author },
    fromMe: userId === context.me,
    text: rendered,
    mentionsMe: facts.users.includes(context.me),
    mentionsMyGroup: facts.groups.some((group) => groups.has(group)),
    broadcast: facts.broadcast,
    sentAt: slackTime(ts),
    permalink: slackPermalink(context.teamUrl, channel, ts, threadId),
  };
};

/** Slack's `ts` (seconds with a sequence after the dot) as an ISO time. */
export const slackTime = (ts: string): string => {
  const seconds = Number(ts);
  return new Date(Number.isFinite(seconds) ? seconds * 1000 : 0).toISOString();
};

/** Slack's own link form: the message, opened in its thread when it is a reply. */
export const slackPermalink = (
  teamUrl: string,
  channel: string,
  ts: string,
  threadId: string | null,
): string | null => {
  if (!teamUrl || !ts) return null;
  const base = `${teamUrl.replace(/\/?$/, "/")}archives/${channel}/p${ts.replace(".", "")}`;
  return threadId ? `${base}?thread_ts=${threadId}&cid=${channel}` : base;
};

const authorOf = async (
  message: Record<string, unknown>,
  context: SlackEventContext,
): Promise<SlackPerson> => {
  const userId = text(message.user);
  if (userId) {
    return context.directory
      .person(userId)
      .catch((): SlackPerson => ({ name: userId, avatarUrl: null }));
  }
  const bot = record(message.bot_profile);
  return {
    name: text(message.username) || text(bot.name) || "A Slack app",
    avatarUrl: text(record(bot.icons).image_72) || null,
  };
};

/** The text with people named, plus the names of attached files. */
const renderText = async (
  message: Record<string, unknown>,
  context: SlackEventContext,
): Promise<string> => {
  const raw = text(message.text);
  const people = mentionFacts(raw).users;
  await Promise.all(people.map((id) => context.directory.person(id).catch(() => null)));
  const body = renderMrkdwn(raw, (id) => context.directory.knownName(id));
  const files = Array.isArray(message.files)
    ? message.files.map((file) => text(record(file).name)).filter(Boolean)
    : [];
  const attached = files.map((name) => `[file: ${name}]`).join(" ");
  return [body, attached].filter(Boolean).join("\n");
};
