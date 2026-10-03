import { INBOX_DEFAULTS, parseLibraryRetentionDays, type Thread } from "@aop/common";
import type { Kysely } from "kysely";
import type { LocalServerContext } from "../context.ts";
import type { IssueService } from "../issues/service.ts";
import { describeServiceError } from "../project/errors.ts";
import type { ProjectService } from "../project/service.ts";
import { SettingKey } from "../settings/types.ts";
import type { ThreadService } from "../thread/service.ts";
import { pullRequestOf } from "../thread/state.ts";
import { createInboxActions, type InboxActions } from "./actions.ts";
import type { InboxDatabase } from "./database.ts";
import { createInboxDispatch, type InboxDispatch } from "./dispatch.ts";
import { createInboxNotifier, type InboxNotifier } from "./notifications.ts";
import { startPostBack } from "./post-back.ts";
import type { InboxLinkRow } from "./repository.ts";
import { startInboxRetention } from "./retention.ts";
import { createInboxService, type InboxService } from "./service.ts";
import { createInboxSourceRepository } from "./source-repository.ts";
import { postNote, readAvailability } from "./sources/slack/conversation.ts";
import {
  createSlackService,
  type SlackService,
  type SlackServiceDeps,
} from "./sources/slack/service.ts";

/**
 * The host's Inbox, put together: its database and rules, the Slack source, the page's actions,
 * dispatch, desktop notifications and the pull request notes. `start` begins the live feed and
 * the housekeeping; the server calls it once it listens, and stops what it returns on shutdown.
 */
export interface HostInbox {
  inbox: InboxService;
  actions: InboxActions;
  dispatch: InboxDispatch;
  slack: SlackService;
  notifier: InboxNotifier;
  start: () => Promise<() => void>;
}

export interface HostInboxDeps {
  threads: Pick<ThreadService, "spawn">;
  projects: Pick<ProjectService, "sendToCoordinator">;
  issues: Pick<IssueService, "detail">;
  /** Tests point the Slack source at a fake Slack and a scratch token directory. */
  slack?: Omit<Partial<SlackServiceDeps>, "inbox" | "sources" | "onNewItem">;
}

const AVAILABILITY_TTL_MS = 60_000;

export const createHostInbox = (
  ctx: LocalServerContext,
  db: Kysely<InboxDatabase>,
  deps: HostInboxDeps,
): HostInbox => {
  const sources = createInboxSourceRepository(db);
  const inbox = createInboxService({
    db,
    retentionDays: async () =>
      parseLibraryRetentionDays(
        await ctx.settingsRepository.get(SettingKey.INBOX_RETENTION_DAYS),
      ) ?? INBOX_DEFAULTS.retentionDays,
    rulesFor: (sourceId) => sources.rules(sourceId),
    linkStatuses: (links) => linkStatuses(links, (id) => ctx.threadRepository.getById(id)),
  });
  const availability = new Map<
    string,
    { at: number; value: Promise<{ away: boolean; doNotDisturb: boolean }> }
  >();
  const notifier = createInboxNotifier({
    modeFor: (sourceId) => sources.notifications(sourceId),
    availability: (sourceId) => {
      const cached = availability.get(sourceId);
      if (cached && Date.now() - cached.at < AVAILABILITY_TTL_MS) return cached.value;
      const feed = slack.feedFor(sourceId);
      const value = feed
        ? readAvailability(feed, Date.now() / 1000)
        : Promise.resolve({ away: false, doNotDisturb: false });
      availability.set(sourceId, { at: Date.now(), value });
      return value;
    },
  });
  const slack = createSlackService({
    ...deps.slack,
    inbox,
    sources,
    onNewItem: (item) => void notifier.consider(item),
  });
  const actions = createInboxActions({ inbox, sources, slack });
  const dispatch = createInboxDispatch({
    inbox,
    actions,
    spawnThread: async (projectId, input) => {
      const spawned = await deps.threads.spawn(projectId, input);
      return spawned.success
        ? { id: spawned.thread.id, title: spawned.thread.title }
        : { error: describeServiceError(spawned.error) };
    },
    askCoordinator: async (projectId, text) => {
      const sent = await deps.projects.sendToCoordinator(projectId, text);
      return sent.success ? null : { error: describeServiceError(sent.error) };
    },
    issueDetail: async (projectId, key) => {
      const result = await deps.issues.detail(projectId, key).catch(() => null);
      return result?.success ? result.detail : null;
    },
  });

  return {
    inbox,
    actions,
    dispatch,
    slack,
    notifier,
    start: async () => {
      await slack.start();
      // Every hour the Inbox forgets the Slack messages that outlived its retention.
      const stopRetention = startInboxRetention(inbox);
      const stopPostBack = startPostBack({
        inbox,
        threadOf: (id) => ctx.threadRepository.getById(id),
        postNote: async (item, note) => {
          const feed = slack.feedFor(item.sourceId);
          if (!feed) return false;
          const threadTs =
            item.threadId ?? (item.conversation.kind === "channel" ? item.messageId : null);
          return (await postNote(feed, item.conversation.id, threadTs, note)).ok;
        },
      });
      return () => {
        stopPostBack();
        stopRetention();
        slack.stop();
      };
    },
  };
};

/**
 * What each link is doing now: a thread's status, and a pull request's state when the item's
 * thread opened it. Other links (issues, pull requests linked by hand) show no status.
 */
const linkStatuses = async (
  links: readonly InboxLinkRow[],
  threadOf: (id: string) => Promise<Thread | null>,
): Promise<Map<string, string | null>> => {
  const threadIds = [
    ...new Set(links.filter((link) => link.kind === "thread").map((link) => link.ref)),
  ];
  const threads = (await Promise.all(threadIds.map((id) => threadOf(id).catch(() => null)))).filter(
    (thread): thread is Thread => thread !== null,
  );
  const statuses = new Map<string, string | null>();
  for (const link of links) {
    if (link.kind === "thread") {
      statuses.set(link.id, threads.find((thread) => thread.id === link.ref)?.status ?? null);
    } else if (link.kind === "pull-request" && link.url) {
      const pullRequest = threads
        .map(pullRequestOf)
        .find((candidate) => candidate?.url === link.url);
      statuses.set(link.id, pullRequest?.state ?? null);
    }
  }
  return statuses;
};
