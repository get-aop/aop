import { z } from "zod";

/**
 * The Inbox: the activity from the person's message sources (Slack first) that needs them, and
 * nothing else. The host matches incoming messages against the rules below and keeps only the
 * matches; these are the shapes its API speaks. Agents never read it: a thread sees a message
 * only when the person dispatches one to it.
 */

/** Why an item is in the Inbox, strongest first: an item shows its strongest reason. */
export const INBOX_REASONS = [
  "mention",
  "dm",
  "thread-reply",
  "group",
  "broadcast",
  "keyword",
] as const;
export const InboxReasonSchema = z.enum(INBOX_REASONS);
export type InboxReason = z.infer<typeof InboxReasonSchema>;

/** A snoozed item whose time has come is shown, counted and listed as unread. */
export const INBOX_STATES = ["unread", "read", "done", "snoozed"] as const;
export const InboxStateSchema = z.enum(INBOX_STATES);
export type InboxState = z.infer<typeof InboxStateSchema>;

/** The Inbox page's lists. All but `snoozed` and `done` show only what still needs the person. */
export const INBOX_VIEWS = ["needs-me", "mentions", "dms", "threads", "snoozed", "done"] as const;
export const InboxViewSchema = z.enum(INBOX_VIEWS);
export type InboxView = z.infer<typeof InboxViewSchema>;

export const INBOX_CONVERSATION_KINDS = ["channel", "dm", "group-dm"] as const;
export const InboxConversationKindSchema = z.enum(INBOX_CONVERSATION_KINDS);
export type InboxConversationKind = z.infer<typeof InboxConversationKindSchema>;

export const InboxConversationSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: InboxConversationKindSchema,
});
export type InboxConversation = z.infer<typeof InboxConversationSchema>;

export const InboxAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type InboxAuthor = z.infer<typeof InboxAuthorSchema>;

/** What an item is linked to in AOP. Links are AOP's own notes: nothing is posted anywhere. */
export const INBOX_LINK_KINDS = ["thread", "pull-request", "issue"] as const;
export const InboxLinkKindSchema = z.enum(INBOX_LINK_KINDS);
export type InboxLinkKind = z.infer<typeof InboxLinkKindSchema>;

export const INBOX_LIMITS = {
  linkRefMaxLength: 500,
  linkTitleMaxLength: 300,
  keywordsMax: 50,
  keywordMaxLength: 60,
  pageMax: 100,
} as const;

export const InboxLinkSchema = z.object({
  id: z.string(),
  kind: InboxLinkKindSchema,
  /** A thread id, `owner/name#number` for a pull request, or an issue source's key. */
  ref: z.string(),
  projectId: z.string().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  createdAt: z.string(),
});
export type InboxLink = z.infer<typeof InboxLinkSchema>;

export const InboxLinkInputSchema = z.object({
  kind: InboxLinkKindSchema,
  ref: z.string().trim().min(1).max(INBOX_LIMITS.linkRefMaxLength),
  projectId: z.string().min(1).nullable().optional(),
  title: z.string().trim().max(INBOX_LIMITS.linkTitleMaxLength).nullable().optional(),
  url: z.url().nullable().optional(),
});
export type InboxLinkInput = z.infer<typeof InboxLinkInputSchema>;

export const InboxItemSchema = z.object({
  id: z.string(),
  /** One connected account, such as `slack:T024BE7LD`. */
  sourceId: z.string(),
  conversation: InboxConversationSchema,
  /** The thread the item's messages belong to, when they are in one. */
  threadId: z.string().nullable(),
  /** The latest matching message's author and text. */
  author: InboxAuthorSchema,
  text: z.string(),
  reason: InboxReasonSchema,
  /** Matching messages gathered into this item: a DM conversation or a thread is one item. */
  messageCount: z.number().int(),
  state: InboxStateSchema,
  snoozedUntil: z.string().nullable(),
  permalink: z.string().nullable(),
  /** The latest message was deleted at its source; its text is gone. */
  deleted: z.boolean(),
  /** Past the Inbox's retention: the text is gone and the item stays only for its links. */
  expired: z.boolean(),
  receivedAt: z.string(),
  links: z.array(InboxLinkSchema),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const InboxItemPageSchema = z.object({
  items: z.array(InboxItemSchema),
  /** Pass back as `cursor` for the next, older page; null on the last one. */
  nextCursor: z.string().nullable(),
});
export type InboxItemPage = z.infer<typeof InboxItemPageSchema>;

export const InboxSummarySchema = z.object({
  /** What the top bar's badge counts: unread items, snoozed ones that are due included. */
  unread: z.number().int(),
});
export type InboxSummary = z.infer<typeof InboxSummarySchema>;

export const InboxStateInputSchema = z.discriminatedUnion("state", [
  z.object({ state: z.enum(["unread", "read", "done"]) }),
  z.object({ state: z.literal("snoozed"), until: z.iso.datetime({ offset: true }) }),
]);
export type InboxStateInput = z.infer<typeof InboxStateInputSchema>;

/**
 * Per channel: `all` follows the rules, `direct-only` keeps only direct mentions of the person,
 * `muted` keeps nothing (not even stored).
 */
export const INBOX_CHANNEL_MODES = ["all", "direct-only", "muted"] as const;
export const InboxChannelModeSchema = z.enum(INBOX_CHANNEL_MODES);
export type InboxChannelMode = z.infer<typeof InboxChannelModeSchema>;

export const InboxChannelRuleSchema = z.object({
  mode: InboxChannelModeSchema,
  /** Preselects this project when the person dispatches a thread from the channel. */
  projectId: z.string().nullable().optional(),
});
export type InboxChannelRule = z.infer<typeof InboxChannelRuleSchema>;

export const InboxRulesSchema = z.object({
  mentions: z.boolean(),
  dms: z.boolean(),
  /** Replies in threads the person started, replied in or was mentioned in. */
  threadReplies: z.boolean(),
  /** Mentions of a group the person is in. */
  groups: z.boolean(),
  /** @here, @channel and @everyone. */
  broadcasts: z.boolean(),
  keywords: z
    .array(z.string().trim().min(1).max(INBOX_LIMITS.keywordMaxLength))
    .max(INBOX_LIMITS.keywordsMax),
  /** Keyed by conversation id; a channel not listed follows the rules above. */
  channels: z.record(z.string(), InboxChannelRuleSchema),
});
export type InboxRules = z.infer<typeof InboxRulesSchema>;

/** Everything that plainly needs the person is on; keywords are the person's to add. */
export const INBOX_DEFAULT_RULES: InboxRules = {
  mentions: true,
  dms: true,
  threadReplies: true,
  groups: true,
  broadcasts: true,
  keywords: [],
  channels: {},
};

/** Matched messages go after 30 days; 0 keeps them. The range is the Library's. */
export const INBOX_DEFAULTS = { retentionDays: 30 } as const;
