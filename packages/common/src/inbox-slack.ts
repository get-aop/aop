import { z } from "zod";

/**
 * Slack, the Inbox's first source. The person creates their own internal Slack app from the
 * manifest below (user-token scopes and Socket Mode, no bot user) and pastes its two tokens into
 * AOP settings › Connections › Slack. The tokens stay on the host: clients may save them, never
 * read them back (decision D3 of the Slack Inbox design).
 */

/** The user-token scopes the app asks for. Reading, names and groups, Do Not Disturb, replies. */
export const SLACK_USER_SCOPES = [
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
  "usergroups:read",
  "dnd:read",
  "team:read",
  "chat:write",
] as const;

/** Message events in every kind of conversation, delivered on behalf of the person. */
export const SLACK_USER_EVENTS = [
  "message.channels",
  "message.groups",
  "message.im",
  "message.mpim",
] as const;

/** Where Slack sends the person back after "Allow": the host's own sign-in callback. */
export const SLACK_OAUTH_CALLBACK_PATH = "/api/inbox/sources/slack/oauth/callback";

/**
 * The app's manifest, for Slack's "Create an app › From a manifest". Socket Mode is on, so Slack
 * never asks for a Request URL. PKCE is on, so the host signs the person in with no client
 * secret, coming back to `redirectUrls` (this host's callback as the person's browser reaches
 * it). Token rotation stays off: the user token then lasts until it is revoked.
 */
export const slackAppManifestYaml = (redirectUrls: readonly string[] = []): string =>
  [
    "display_information:",
    "  name: AOP Inbox",
    "  description: Your Slack mentions, DMs and thread replies, in AOP on your own host.",
    "oauth_config:",
    ...(redirectUrls.length > 0
      ? ["  redirect_urls:", ...redirectUrls.map((url) => `    - ${url}`)]
      : []),
    "  pkce_enabled: true",
    "  scopes:",
    "    user:",
    ...SLACK_USER_SCOPES.map((scope) => `      - ${scope}`),
    "settings:",
    "  event_subscriptions:",
    "    user_events:",
    ...SLACK_USER_EVENTS.map((event) => `      - ${event}`),
    "  socket_mode_enabled: true",
    "  token_rotation_enabled: false",
    "  org_deploy_enabled: false",
    "",
  ].join("\n");

/** Slack's page that creates an app from a manifest, with this one filled in. */
export const slackCreateAppUrl = (redirectUrls: readonly string[] = []): string =>
  `https://api.slack.com/apps?new_app=1&manifest_yaml=${encodeURIComponent(slackAppManifestYaml(redirectUrls))}`;

export const SLACK_LIMITS = { tokenMaxLength: 500, replyMaxLength: 4000 } as const;

const token = z.string().trim().min(1).max(SLACK_LIMITS.tokenMaxLength);

export const SlackTokensInputSchema = z.object({ userToken: token, appToken: token });

/**
 * Sign in with Slack (PKCE): the app's Client ID (public, on Basic Information) and its
 * app-level token, the one secret to paste. The host answers with Slack's "Allow" page address.
 */
export const SlackSignInInputSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^\d+\.\d+$/, "A Client ID looks like 1234567890.1234567890"),
  appToken: token,
  /** This host's sign-in callback, as the person's browser reaches it. */
  redirectUrl: z.url(),
});
export type SlackSignInInput = z.infer<typeof SlackSignInInputSchema>;
export type SlackTokensInput = z.infer<typeof SlackTokensInputSchema>;

/**
 * Test the pasted tokens, or the saved ones when none are given. `sendTestMessage` posts
 * "AOP connection test" to the person's own DM as them and deletes it once it arrives.
 */
export const SlackTestInputSchema = z.object({
  userToken: token.optional(),
  appToken: token.optional(),
  sendTestMessage: z.boolean().default(false),
});
export type SlackTestInput = z.infer<typeof SlackTestInputSchema>;

export const SLACK_TEST_CHECKS = ["user-token", "scopes", "app-token", "groups", "events"] as const;
export type SlackTestCheckId = (typeof SLACK_TEST_CHECKS)[number];

export const SlackTestCheckSchema = z.object({
  id: z.enum(SLACK_TEST_CHECKS),
  /** null when an earlier check failed and this one did not run. */
  ok: z.boolean().nullable(),
  detail: z.string(),
  /** What to do in Slack's app settings when the check failed. */
  fix: z.string().nullable(),
});
export type SlackTestCheck = z.infer<typeof SlackTestCheckSchema>;

export const SlackTestReportSchema = z.object({
  ok: z.boolean(),
  checks: z.array(SlackTestCheckSchema),
});
export type SlackTestReport = z.infer<typeof SlackTestReportSchema>;

/**
 * How the live feed is doing. `no-events` is the failure the design's first test found: the
 * socket connects and Slack says hello, but no event ever comes, because Socket Mode is off in
 * the app's settings. The Inbox still fills from catch-up reads, late.
 */
export const SLACK_HEALTH = ["connecting", "live", "no-events", "offline", "revoked"] as const;
export const SlackHealthSchema = z.enum(SLACK_HEALTH);
export type SlackHealth = z.infer<typeof SlackHealthSchema>;

/** When the host shows a desktop notification for a new item. */
export const INBOX_NOTIFY_MODES = ["off", "away", "all"] as const;
export const InboxNotifyModeSchema = z.enum(INBOX_NOTIFY_MODES);
export type InboxNotifyMode = z.infer<typeof InboxNotifyModeSchema>;

/** A connected workspace, as clients see it: never its tokens. */
export const SlackConnectionSchema = z.object({
  sourceId: z.string(),
  teamId: z.string(),
  teamName: z.string(),
  /** `https://acme.slack.com/`, for links into Slack. */
  teamUrl: z.string(),
  userId: z.string(),
  userName: z.string(),
  connectedAt: z.string(),
  health: SlackHealthSchema,
  lastEventAt: z.string().nullable(),
  /** What is wrong and how to fix it, while `health` is not `live` or `connecting`. */
  problem: z.string().nullable(),
  missingScopes: z.array(z.string()),
  notifications: InboxNotifyModeSchema,
});
export type SlackConnection = z.infer<typeof SlackConnectionSchema>;

export const InboxSourcesSchema = z.object({
  slack: SlackConnectionSchema.nullable(),
  /** Tokens left on the host by the Slack connection test, which can be imported once. */
  slackImportAvailable: z.boolean(),
});
export type InboxSources = z.infer<typeof InboxSourcesSchema>;

export const InboxNotificationsInputSchema = z.object({ mode: InboxNotifyModeSchema });

export const SlackDisconnectInputSchema = z.object({
  deleteMessages: z.boolean().default(false),
});

/** A conversation the person is in, for the rules' channel table. */
export const SlackChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  private: z.boolean(),
});
export type SlackChannel = z.infer<typeof SlackChannelSchema>;
