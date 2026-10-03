import {
  INBOX_REASONS,
  type InboxAuthor,
  type InboxConversation,
  type InboxReason,
  type InboxRules,
} from "@aop/common";

/**
 * A message as a source hands it to the Inbox: already turned from its platform's shape into the
 * facts the rules need. A source works out the mentions (Slack: `<@U…>`, `<!here>`,
 * `<!subteam^…>` for a group the person is in); the Inbox never parses a platform's markup.
 */
export interface IncomingMessage {
  /** One connected account, such as `slack:T024BE7LD`. */
  sourceId: string;
  /** Unique within its conversation (Slack: the message's `ts`). */
  messageId: string;
  conversation: InboxConversation;
  /** The thread's first message id, for a reply in a thread; null for a message on its own. */
  threadId: string | null;
  author: InboxAuthor;
  fromMe: boolean;
  /** Plain text, mentions resolved to names. */
  text: string;
  mentionsMe: boolean;
  mentionsMyGroup: boolean;
  /** @here, @channel or @everyone. */
  broadcast: boolean;
  sentAt: string;
  permalink: string | null;
}

/**
 * Why a message needs the person, or null when it does not. `inMyThread` is whether it is a reply
 * in a thread the person is part of. The person's own messages never do; a muted channel keeps
 * nothing; a channel set to direct mentions only keeps direct mentions only.
 */
export const matchMessage = (
  message: IncomingMessage,
  rules: InboxRules,
  inMyThread: boolean,
): InboxReason | null => {
  if (message.fromMe) return null;
  const mode = rules.channels[message.conversation.id]?.mode ?? "all";
  if (mode === "muted") return null;
  if (mode === "direct-only")
    return TRIGGERS.mention(message, rules, inMyThread) ? "mention" : null;
  return INBOX_REASONS.find((reason) => TRIGGERS[reason](message, rules, inMyThread)) ?? null;
};

/** Whether each reason applies, checked strongest first, so the first that does is the item's. */
const TRIGGERS: Record<
  InboxReason,
  (message: IncomingMessage, rules: InboxRules, inMyThread: boolean) => boolean
> = {
  mention: (message, rules) => rules.mentions && message.mentionsMe,
  dm: (message, rules) => rules.dms && message.conversation.kind !== "channel",
  "thread-reply": (_message, rules, inMyThread) => rules.threadReplies && inMyThread,
  group: (message, rules) => rules.groups && message.mentionsMyGroup,
  broadcast: (message, rules) => rules.broadcasts && message.broadcast,
  keyword: (message, rules) => matchesKeyword(message.text, rules.keywords),
};

/** The stronger of two reasons, in the order INBOX_REASONS lists them. */
export const strongerReason = (a: InboxReason, b: InboxReason): InboxReason =>
  INBOX_REASONS.indexOf(a) <= INBOX_REASONS.indexOf(b) ? a : b;

/** A keyword matches as a whole word or phrase, ignoring case. */
export const matchesKeyword = (text: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => wholeWord(keyword).test(text));

const wholeWord = (keyword: string): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_])${keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`,
    "iu",
  );
