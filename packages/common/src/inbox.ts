import { z } from "zod";
import { SlackHealthSchema } from "./inbox-slack.ts";

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
  /**
   * For a thread, its status; for a pull request, its state (`open`, `merged`, ...); null when the
   * host cannot tell (an issue, or a thread that is gone).
   */
  status: z.string().nullable(),
  /** For a thread dispatched from the item: AOP posts its PR notes in the Slack thread, as the person. */
  postBack: z.boolean(),
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
  /** The latest matching message (Slack: its `ts`): a reply from the item answers it. */
  messageId: z.string(),
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
  /** Whether any source is connected; the top bar shows the Inbox only then. */
  connected: z.boolean(),
  /** The connected source's feed, for the Inbox header; null when none is connected. */
  health: SlackHealthSchema.nullable(),
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
  /** The channel's name when the rule was set, so the rules read without asking the source. */
  name: z.string().max(200).optional(),
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

/** A message of an item's conversation, read from its source when the item is opened. Never stored. */
export const InboxContextMessageSchema = z.object({
  id: z.string(),
  author: InboxAuthorSchema,
  text: z.string(),
  sentAt: z.string(),
  fromMe: z.boolean(),
  /** The person sent it from AOP's reply box. */
  fromAop: z.boolean(),
});
export type InboxContextMessage = z.infer<typeof InboxContextMessageSchema>;

export const InboxContextSchema = z.object({
  /** The thread's first message, for an item in a thread. */
  parent: InboxContextMessageSchema.nullable(),
  /** The latest messages, oldest first; every one of them when `all` was asked for. */
  messages: z.array(InboxContextMessageSchema),
  /** Messages between the parent and `messages` not shown. */
  earlier: z.number().int(),
});
export type InboxContext = z.infer<typeof InboxContextSchema>;

export const InboxReplyInputSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  /** Also send a thread reply to the channel. */
  broadcast: z.boolean().default(false),
});
export type InboxReplyInput = z.infer<typeof InboxReplyInputSchema>;

export const INBOX_DISPATCH_MODES = ["thread", "coordinator"] as const;

export const INBOX_BRIEF_LIMITS = { titleMax: 200, briefMax: 20_000, contextMax: 6000 } as const;

/**
 * Dispatch a thread from an item. `brief` is the person's edited text; the host adds the parts
 * they left ticked (the thread's context, a linked issue, the Slack link), quoted the same way.
 */
export const InboxDispatchInputSchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(INBOX_DISPATCH_MODES),
  /** The thread's repository; required when the project has more than one. */
  repoId: z.string().min(1).nullable().default(null),
  title: z.string().trim().min(1).max(INBOX_BRIEF_LIMITS.titleMax),
  brief: z.string().trim().min(1).max(INBOX_BRIEF_LIMITS.briefMax),
  includeContext: z.boolean().default(true),
  /** An issue link of the item whose title, link and description go into the brief. */
  issueLinkId: z.string().min(1).nullable().default(null),
  attachLink: z.boolean().default(true),
  /** Post "Opened a PR" and "Merged" notes in the Slack thread, as the person. Off unless confirmed. */
  postBack: z.boolean().default(false),
});
export type InboxDispatchInput = z.infer<typeof InboxDispatchInputSchema>;

/** What the dispatch dialog starts from. */
export const InboxDispatchDraftSchema = z.object({
  title: z.string(),
  brief: z.string(),
  /** Characters the thread's context adds when ticked; 0 when there is none. */
  contextLength: z.number().int(),
  /** The project the channel is mapped to, preselected. */
  projectId: z.string().nullable(),
  /** The exact notes the post-back would send, with the pull request filled in later. */
  postBackPreview: z.array(z.string()),
});
export type InboxDispatchDraft = z.infer<typeof InboxDispatchDraftSchema>;

export const InboxLinkPatchSchema = z.object({ postBack: z.boolean() });

/** A desktop notification the host decided a new item deserves. */
export const InboxNotificationSchema = z.object({
  seq: z.number().int(),
  itemId: z.string(),
  title: z.string(),
  body: z.string(),
});
export type InboxNotification = z.infer<typeof InboxNotificationSchema>;

export const InboxNotificationsPageSchema = z.object({
  /** Pass back as `after` to get only what came since. */
  cursor: z.number().int(),
  notifications: z.array(InboxNotificationSchema),
});
export type InboxNotificationsPage = z.infer<typeof InboxNotificationsPageSchema>;
