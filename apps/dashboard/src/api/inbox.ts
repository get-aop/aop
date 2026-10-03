import {
  type InboxChannelMode,
  type InboxContext,
  InboxContextMessageSchema,
  InboxContextSchema,
  type InboxDispatchDraft,
  InboxDispatchDraftSchema,
  type InboxDispatchInput,
  type InboxItem,
  type InboxItemPage,
  InboxItemPageSchema,
  InboxItemSchema,
  type InboxLinkInput,
  type InboxNotifyMode,
  type InboxReplyInput,
  type InboxRules,
  InboxRulesSchema,
  type InboxSources,
  InboxSourcesSchema,
  type InboxStateInput,
  type InboxSummary,
  InboxSummarySchema,
  type InboxView,
  type SlackChannel,
  SlackChannelSchema,
  type SlackConnection,
  SlackConnectionSchema,
  type SlackSignInInput,
  type SlackTestInput,
  type SlackTestReport,
  SlackTestReportSchema,
  type SlackTokensInput,
} from "@aop/common";
import { request } from "./request";

/** The Inbox's host API (`/api/inbox`): any paired device may use it, tokens are write-only. */

export const getInboxSummary = async (): Promise<InboxSummary> =>
  InboxSummarySchema.parse(await request("/inbox/summary"));

export const listInboxItems = async (
  view: InboxView,
  options: { cursor?: string; projectId?: string } = {},
): Promise<InboxItemPage> => {
  const params = new URLSearchParams({ view });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.projectId) params.set("project", options.projectId);
  return InboxItemPageSchema.parse(await request(`/inbox/items?${params}`));
};

const item = (id: string) => `/inbox/items/${encodeURIComponent(id)}`;
const parseItem = (body: { item: unknown }): InboxItem => InboxItemSchema.parse(body.item);

export const getInboxItem = async (id: string): Promise<InboxItem> =>
  parseItem(await request<{ item: unknown }>(item(id)));

export const getInboxContext = async (id: string, all = false): Promise<InboxContext> =>
  InboxContextSchema.parse(
    (await request<{ context: unknown }>(`${item(id)}/context${all ? "?all=1" : ""}`)).context,
  );

export const setInboxState = async (id: string, input: InboxStateInput): Promise<InboxItem> =>
  parseItem(
    await request<{ item: unknown }>(`${item(id)}/state`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  );

/** Sends the reply to Slack, as the person. Only their click calls this. */
export const replyToInboxItem = async (id: string, input: InboxReplyInput) => {
  const body = await request<{ message: unknown; item: unknown }>(`${item(id)}/reply`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return { message: InboxContextMessageSchema.parse(body.message), item: parseItem(body) };
};

export const getDispatchDraft = async (id: string): Promise<InboxDispatchDraft> =>
  InboxDispatchDraftSchema.parse((await request<{ draft: unknown }>(`${item(id)}/dispatch`)).draft);

export const dispatchFromInbox = async (
  id: string,
  input: InboxDispatchInput,
): Promise<{ item: InboxItem; threadId: string | null }> => {
  const body = await request<{ item: unknown; threadId: string | null }>(`${item(id)}/dispatch`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return { item: parseItem(body), threadId: body.threadId };
};

export const linkInboxItem = async (id: string, input: InboxLinkInput): Promise<InboxItem> =>
  parseItem(
    await request<{ item: unknown }>(`${item(id)}/links`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );

export const unlinkInboxItem = async (id: string, linkId: string): Promise<InboxItem> =>
  parseItem(
    await request<{ item: unknown }>(`${item(id)}/links/${encodeURIComponent(linkId)}`, {
      method: "DELETE",
    }),
  );

export const setLinkPostBack = async (
  id: string,
  linkId: string,
  postBack: boolean,
): Promise<InboxItem> =>
  parseItem(
    await request<{ item: unknown }>(`${item(id)}/links/${encodeURIComponent(linkId)}`, {
      method: "PATCH",
      body: JSON.stringify({ postBack }),
    }),
  );

export const getInboxRules = async (): Promise<InboxRules> =>
  InboxRulesSchema.parse((await request<{ rules: unknown }>("/inbox/rules")).rules);

export const saveInboxRules = async (rules: InboxRules): Promise<InboxRules> =>
  InboxRulesSchema.parse(
    (
      await request<{ rules: unknown }>("/inbox/rules", {
        method: "PUT",
        body: JSON.stringify(rules),
      })
    ).rules,
  );

/** Sets one channel's mode, keeping its project mapping. */
export const setChannelMode = async (
  channel: { id: string; name: string },
  mode: InboxChannelMode,
): Promise<InboxRules> => {
  const rules = await getInboxRules();
  const current = rules.channels[channel.id];
  return saveInboxRules({
    ...rules,
    channels: { ...rules.channels, [channel.id]: { ...current, mode, name: channel.name } },
  });
};

export const getInboxSources = async (): Promise<InboxSources> =>
  InboxSourcesSchema.parse(await request("/inbox/sources"));

const parseConnection = (body: { connection: unknown }): SlackConnection =>
  SlackConnectionSchema.parse(body.connection);

/** Saves the two tokens; they are never read back. */
export const connectSlack = async (tokens: SlackTokensInput): Promise<SlackConnection> =>
  parseConnection(
    await request<{ connection: unknown }>("/inbox/sources/slack", {
      method: "PUT",
      body: JSON.stringify(tokens),
    }),
  );

/** Slack's "Allow" page for the person's own app (PKCE: no secret leaves Slack or the host). */
export const beginSlackSignIn = async (input: SlackSignInInput): Promise<string> =>
  (
    await request<{ authorizeUrl: string }>("/inbox/sources/slack/sign-in", {
      method: "POST",
      body: JSON.stringify(input),
    })
  ).authorizeUrl;

export const importSlackTokens = async (): Promise<SlackConnection> =>
  parseConnection(
    await request<{ connection: unknown }>("/inbox/sources/slack/import", { method: "POST" }),
  );

export const testSlack = async (input: SlackTestInput): Promise<SlackTestReport> =>
  SlackTestReportSchema.parse(
    (
      await request<{ report: unknown }>("/inbox/sources/slack/test", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).report,
  );

export const disconnectSlack = async (deleteMessages: boolean): Promise<void> => {
  await request(`/inbox/sources/slack${deleteMessages ? "?deleteMessages=1" : ""}`, {
    method: "DELETE",
  });
};

export const setSlackNotifications = async (mode: InboxNotifyMode): Promise<SlackConnection> =>
  parseConnection(
    await request<{ connection: unknown }>("/inbox/sources/slack/notifications", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),
  );

export const listSlackChannels = async (): Promise<SlackChannel[]> =>
  SlackChannelSchema.array().parse(
    (await request<{ channels: unknown }>("/inbox/sources/slack/channels")).channels,
  );
