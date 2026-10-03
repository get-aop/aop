import {
  INBOX_DEFAULT_RULES,
  type InboxContext,
  type InboxContextMessage,
  type InboxItem,
  type InboxItemPage,
  type InboxReplyInput,
  type InboxRules,
  type InboxSources,
  type InboxSummary,
  type InboxView,
  type SlackChannel,
} from "@aop/common";
import type { InboxResult, InboxService } from "./service.ts";
import type { InboxSourceRepository } from "./source-repository.ts";
import { slackSourceId } from "./sources/slack/connection-store.ts";
import { listChannels, postReply, readContext } from "./sources/slack/conversation.ts";
import type { SlackService } from "./sources/slack/service.ts";

/**
 * What the Inbox page asks of the host beyond triage: the top bar's summary, the list filtered
 * to a project's channels, an item's context read from Slack, a reply sent as the person, and
 * the rules. Each goes through the item's own workspace.
 */
export interface InboxActions {
  summary: () => Promise<InboxSummary>;
  sources: () => Promise<InboxSources>;
  list: (
    view: InboxView,
    page: { cursor?: string; limit?: number; projectId?: string },
  ) => Promise<InboxResult<{ page: InboxItemPage }>>;
  context: (id: string, all: boolean) => Promise<InboxResult<{ context: InboxContext }>>;
  reply: (
    id: string,
    input: InboxReplyInput,
  ) => Promise<InboxResult<{ message: InboxContextMessage; item: InboxItem }>>;
  rules: () => Promise<InboxRules>;
  setRules: (rules: InboxRules) => Promise<InboxResult<{ rules: InboxRules }>>;
  channels: () => Promise<InboxResult<{ channels: SlackChannel[] }>>;
}

export const createInboxActions = (deps: {
  inbox: InboxService;
  sources: InboxSourceRepository;
  slack: SlackService;
}): InboxActions => {
  const { inbox, sources, slack } = deps;

  const currentSource = async (): Promise<string | null> => {
    const connection = await slack.connection();
    return connection ? connection.sourceId : null;
  };

  const feedOf = (item: InboxItem) => slack.feedFor(item.sourceId);

  return {
    summary: async () => {
      const connection = await slack.connection();
      return {
        unread: await inbox.unread(),
        connected: connection !== null,
        health: connection?.health ?? null,
      };
    },

    sources: async () => ({
      slack: await slack.connection(),
      slackImportAvailable: await slack.importAvailable(),
    }),

    list: async (view, page) => {
      if (!page.projectId) return inbox.list(view, page);
      const source = await currentSource();
      const rules = source ? await sources.rules(source) : INBOX_DEFAULT_RULES;
      const conversations = Object.entries(rules.channels)
        .filter(([, rule]) => rule.projectId === page.projectId)
        .map(([id]) => id);
      return inbox.list(view, { ...page, conversations });
    },

    context: async (id, all) => {
      const found = await inbox.get(id);
      if (!found.success) return found;
      const feed = feedOf(found.item);
      if (!feed) return { success: false, error: { code: "NOT_CONNECTED" } };
      const result = await readContext(feed, found.item, all, (ids) =>
        inbox.sentFrom(found.item.sourceId, found.item.conversation.id, ids),
      );
      return result.ok
        ? { success: true, context: result.context }
        : { success: false, error: { code: "SOURCE_FAILED", message: result.message } };
    },

    reply: async (id, input) => {
      const found = await inbox.get(id);
      if (!found.success) return found;
      const feed = feedOf(found.item);
      if (!feed) return { success: false, error: { code: "NOT_CONNECTED" } };
      const sent = await postReply(feed, found.item, input);
      if (!sent.ok) {
        return { success: false, error: { code: "SOURCE_FAILED", message: sent.message } };
      }
      await inbox.noteReply(found.item, sent.message.id);
      const item = await inbox.get(id);
      return item.success ? { success: true, message: sent.message, item: item.item } : item;
    },

    rules: async () => {
      const source = await currentSource();
      return source ? sources.rules(source) : INBOX_DEFAULT_RULES;
    },

    setRules: async (rules) => {
      const connection = await slack.connection();
      if (!connection) return { success: false, error: { code: "NOT_CONNECTED" } };
      await sources.setRules(slackSourceId(connection.teamId), rules);
      return { success: true, rules };
    },

    channels: async () => {
      const connection = await slack.connection();
      const feed = connection ? slack.feedFor(connection.sourceId) : null;
      if (!feed) return { success: false, error: { code: "NOT_CONNECTED" } };
      const result = await listChannels(feed);
      return result.ok
        ? { success: true, channels: result.channels }
        : { success: false, error: { code: "SOURCE_FAILED", message: result.message } };
    },
  };
};
