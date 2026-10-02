import type { GithubUser, PullRequestViewCommit, PullRequestViewTimelineItem } from "@aop/common";
import { rollupState } from "./checks.ts";
import type { RawCommit, RawTimelineNode } from "./queries.ts";
import { itemsOf } from "./queries.ts";

type TimelineEvent = Extract<PullRequestViewTimelineItem, { kind: "event" }>;

/**
 * The Conversation tab's timeline, oldest first. Commits pushed one after another fold into one
 * entry ("added 3 commits"), as on GitHub; an entry of a type AOP does not know is left out.
 */
export const timelineOf = (nodes: RawTimelineNode[]): PullRequestViewTimelineItem[] => {
  const items: PullRequestViewTimelineItem[] = [];
  for (const node of nodes) {
    const item = itemOf(node);
    if (!item) continue;
    const last = items.at(-1);
    if (item.kind === "commits" && last?.kind === "commits") {
      last.commits.push(...item.commits);
    } else {
      items.push(item);
    }
  }
  return items;
};

export const commitOf = (commit: RawCommit): PullRequestViewCommit => ({
  sha: commit.oid,
  shortSha: commit.abbreviatedOid,
  headline: commit.messageHeadline,
  url: commit.url,
  committedAt: commit.committedDate,
  authors: itemsOf(commit.authors).flatMap((author) =>
    author.user
      ? [userOf(author.user)]
      : author.name
        ? [{ login: author.name, avatarUrl: null }]
        : [],
  ),
  checks: rollupState(commit.statusCheckRollup?.state),
});

export const userOf = (user: { login: string; avatarUrl?: string | null }): GithubUser => ({
  login: user.login,
  avatarUrl: user.avatarUrl ?? null,
});

const itemOf = (node: RawTimelineNode): PullRequestViewTimelineItem | null => {
  switch (node.__typename) {
    case "IssueComment":
      return { kind: "comment", ...commentOf(node) };
    case "PullRequestReview":
      return { kind: "review", state: reviewState(node.state), ...commentOf(node) };
    case "PullRequestCommit":
      return node.commit && "oid" in node.commit
        ? { kind: "commits", at: node.commit.committedDate, commits: [commitOf(node.commit)] }
        : null;
    default:
      return eventOf(node);
  }
};

const commentOf = (node: RawTimelineNode) => ({
  id: node.id ?? `${node.__typename}:${node.createdAt}`,
  author: node.author ? userOf(node.author) : null,
  body: node.body ?? "",
  createdAt: node.submittedAt ?? node.createdAt ?? "",
  url: node.url ?? null,
});

const REVIEW_STATES: Record<
  string,
  Extract<PullRequestViewTimelineItem, { kind: "review" }>["state"]
> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
};

const reviewState = (state: string | undefined) => REVIEW_STATES[state ?? ""] ?? "commented";

const EVENTS: Record<string, TimelineEvent["event"]> = {
  LabeledEvent: "labeled",
  UnlabeledEvent: "unlabeled",
  ClosedEvent: "closed",
  ReopenedEvent: "reopened",
  MergedEvent: "merged",
  ReadyForReviewEvent: "ready_for_review",
  ConvertToDraftEvent: "converted_to_draft",
  HeadRefForcePushedEvent: "force_pushed",
  ReviewRequestedEvent: "review_requested",
  AssignedEvent: "assigned",
  RenamedTitleEvent: "renamed",
  CrossReferencedEvent: "referenced",
  BaseRefChangedEvent: "base_changed",
  HeadRefDeletedEvent: "head_deleted",
  AutoMergeEnabledEvent: "auto_merge_enabled",
};

const eventOf = (node: RawTimelineNode): TimelineEvent | null => {
  const event = EVENTS[node.__typename];
  if (!event) return null;
  return {
    kind: "event",
    event,
    at: node.createdAt ?? "",
    actor: node.actor?.login ?? null,
    ...detailOf(node),
  };
};

type EventDetail = Pick<TimelineEvent, "label" | "subject" | "url">;

/** What each kind of event names, beside who did it and when. */
const EVENT_DETAIL: Record<string, (node: RawTimelineNode) => EventDetail> = {
  LabeledEvent: (node) => labelOf(node),
  UnlabeledEvent: (node) => labelOf(node),
  ReviewRequestedEvent: (node) => ({
    subject: node.requestedReviewer?.login ?? node.requestedReviewer?.name,
  }),
  AssignedEvent: (node) => ({ subject: node.assignee?.login }),
  RenamedTitleEvent: (node) => ({
    subject: `${node.previousTitle ?? ""} → ${node.currentTitle ?? ""}`,
  }),
  CrossReferencedEvent: ({ source }) =>
    source?.url
      ? { subject: `#${source.number} ${source.title ?? ""}`.trim(), url: source.url }
      : {},
  HeadRefForcePushedEvent: (node) => ({ subject: node.afterCommit?.abbreviatedOid }),
  MergedEvent: ({ commit }) => ({ subject: commit?.abbreviatedOid }),
  BaseRefChangedEvent: (node) => ({ subject: node.currentRefName }),
  HeadRefDeletedEvent: (node) => ({ subject: node.headRefName }),
};

const detailOf = (node: RawTimelineNode): EventDetail =>
  EVENT_DETAIL[node.__typename]?.(node) ?? {};

const labelOf = ({ label }: RawTimelineNode): EventDetail =>
  label ? { label: { name: label.name, color: label.color } } : {};
