import type { InboxItem, PullRequestRef, Thread } from "@aop/common";
import { getLogger } from "@aop/infra";
import { startPeriodicJob } from "../process/periodic-job.ts";
import { pullRequestOf } from "../thread/state.ts";
import { postBackNotes } from "./brief.ts";
import type { InboxLinkRow } from "./repository.ts";
import type { InboxService } from "./service.ts";

/**
 * Follows the threads dispatched from items. When one opens a pull request, the item gets the
 * PR's link without anyone adding it; when the person turned the post-back on (decision D5), the
 * host also posts "Opened a PR for this" and later "Merged" in the item's Slack thread, as them,
 * from a fixed template. Each happens once: the link records how far it got before anything is
 * posted, so a failed post is not retried into a duplicate.
 */
export interface PostBackDeps {
  inbox: InboxService;
  threadOf: (threadId: string) => Promise<FollowedThread | null>;
  postNote: (item: InboxItem, note: string) => Promise<boolean>;
}

/** What the host reads of a dispatched thread. */
export type FollowedThread = Pick<Thread, "title" | "status" | "artifacts">;

const logger = getLogger("inbox", "post-back");
const INTERVAL_MS = 30_000;

export const startPostBack = (deps: PostBackDeps): (() => void) =>
  startPeriodicJob({
    name: "Inbox pull request notes",
    run: () => followDispatchedThreads(deps),
    startupDelayMs: INTERVAL_MS,
    intervalMs: INTERVAL_MS,
  });

export const followDispatchedThreads = async (deps: PostBackDeps): Promise<void> => {
  for (const link of await deps.inbox.watchedThreadLinks()) {
    await follow(deps, link).catch((error: unknown) => {
      logger.warn("Could not follow thread {threadId}: {error}", {
        threadId: link.ref,
        error: String(error),
      });
    });
  }
};

const follow = async (deps: PostBackDeps, link: InboxLinkRow): Promise<void> => {
  const thread = await deps.threadOf(link.ref);
  const pullRequest = thread ? pullRequestOf(thread) : null;
  if (thread && pullRequest) {
    await report(deps, link, thread, pullRequest);
  } else if (!thread || thread.status === "resolved") {
    // A thread that is gone, or resolved without a pull request, has nothing more to report.
    await deps.inbox.notePullRequest(link, "closed");
  }
};

const report = async (
  deps: PostBackDeps,
  link: InboxLinkRow,
  thread: FollowedThread,
  pullRequest: PullRequestRef,
): Promise<void> => {
  const found = await deps.inbox.get(link.item_id);
  if (!found.success) return;
  const label = pullRequestLabel(pullRequest.url, pullRequest.number);
  const notes = postBackNotes({ label, url: pullRequest.url }, thread.title);
  const post = (note: string) =>
    link.post_back === 1 ? deps.postNote(found.item, note) : Promise.resolve(false);
  if (link.pr_noted === null) {
    await noteOpened(deps, link, { label, url: pullRequest.url, title: thread.title });
    await post(notes.opened);
  }
  if (pullRequest.state === "merged" || pullRequest.state === "closed") {
    await deps.inbox.notePullRequest(link, pullRequest.state);
    if (pullRequest.state === "merged") await post(notes.merged);
  }
};

/** The thread opened its pull request: the item links it, once. */
const noteOpened = async (
  deps: PostBackDeps,
  link: InboxLinkRow,
  pullRequest: { label: string; url: string; title: string },
): Promise<void> => {
  await deps.inbox.notePullRequest(link, "opened");
  await deps.inbox.link(link.item_id, {
    kind: "pull-request",
    ref: pullRequest.label,
    projectId: link.project_id,
    title: pullRequest.title,
    url: pullRequest.url,
  });
};

/** `owner/name#12` from a GitHub pull request's address. */
export const pullRequestLabel = (url: string, number: number): string => {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(url);
  return match ? `${match[1]}#${number}` : `#${number}`;
};
