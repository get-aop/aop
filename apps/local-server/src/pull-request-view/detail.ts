import type {
  PullRequestViewChecksResponse,
  PullRequestViewDetail,
  PullRequestViewReviewer,
  PullRequestViewReviewThread,
  PullRequestViewState,
  PullRequestViewViewer,
} from "@aop/common";
import { checksOf } from "./checks.ts";
import { mergeBoxOf } from "./merge-box.ts";
import { itemsOf, type RawHead, type RawPullRequest, type RawRepo } from "./queries.ts";
import type { BranchRules } from "./rules.ts";
import { commitOf, timelineOf, userOf } from "./timeline.ts";

export interface DetailContext {
  repoId: string;
  nameWithOwner: string;
  repo: RawRepo;
  rules: BranchRules;
  viewer: PullRequestViewViewer;
  fetchedAt: string;
}

/** The page's data from one GraphQL answer and the base branch's rules. */
export const detailOf = (pr: RawPullRequest, context: DetailContext): PullRequestViewDetail => {
  const { checks, merge } = checksPartOf(pr, context);
  const headOwner = pr.headRepositoryOwner?.login;
  return {
    repoId: context.repoId,
    nameWithOwner: context.nameWithOwner,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: stateOf(pr.state),
    isDraft: pr.isDraft,
    body: pr.body,
    author: pr.author ? userOf(pr.author) : null,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt ?? null,
    closedAt: pr.closedAt ?? null,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headLabel:
      pr.isCrossRepository && headOwner ? `${headOwner}:${pr.headRefName}` : pr.headRefName,
    headSha: pr.headRefOid,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commitCount: pr.commits.totalCount,
    commentCount: pr.comments.totalCount,
    labels: itemsOf(pr.labels),
    assignees: itemsOf(pr.assignees).map(userOf),
    milestone: pr.milestone
      ? { title: pr.milestone.title, url: pr.milestone.url, dueOn: pr.milestone.dueOn ?? null }
      : null,
    reviewers: reviewersOf(pr),
    linkedIssues: itemsOf(pr.closingIssuesReferences).map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      state: issue.state === "OPEN" ? "open" : "closed",
    })),
    checks,
    commits: itemsOf(pr.commits).map((node) => commitOf(node.commit)),
    timeline: timelineOf(itemsOf(pr.timelineItems)),
    timelineTotal: pr.timelineItems.totalCount,
    reviewThreads: reviewThreadsOf(pr),
    merge,
    viewer: context.viewer,
    fetchedAt: context.fetchedAt,
  };
};

/** The polled part: checks and the merge box, computed exactly as the full page computes them. */
export const checksPartOf = (
  head: RawHead | RawPullRequest,
  context: Pick<DetailContext, "repo" | "rules" | "fetchedAt">,
): PullRequestViewChecksResponse => {
  const checks = checksOf(head);
  const unresolvedThreads = itemsOf(head.reviewThreads).filter(
    (thread) => !thread.isResolved,
  ).length;
  return {
    state: stateOf(head.state),
    headSha: head.headRefOid,
    checks,
    merge: mergeBoxOf({
      head,
      repo: context.repo,
      checks,
      unresolvedThreads,
      rules: context.rules,
    }),
    fetchedAt: context.fetchedAt,
  };
};

const stateOf = (state: RawHead["state"]): PullRequestViewState =>
  state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open";

const REVIEW: Record<string, PullRequestViewReviewer["state"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

/** Who reviewed (their latest review) and who is asked to; asking again puts a reviewer back to requested. */
const reviewersOf = (pr: RawPullRequest): PullRequestViewReviewer[] => {
  const reviewers = new Map<string, PullRequestViewReviewer>();
  for (const reviewer of [...reviewedBy(pr), ...requested(pr)])
    reviewers.set(reviewer.login, reviewer);
  return [...reviewers.values()];
};

const reviewedBy = (pr: RawPullRequest): PullRequestViewReviewer[] =>
  itemsOf(pr.latestReviews).flatMap(({ author, state }) => {
    const shown = REVIEW[state];
    return author && shown
      ? [{ login: author.login, avatarUrl: author.avatarUrl ?? null, isTeam: false, state: shown }]
      : [];
  });

const requested = (pr: RawPullRequest): PullRequestViewReviewer[] =>
  itemsOf(pr.reviewRequests).flatMap(({ requestedReviewer: reviewer }) => {
    const login = reviewer?.login ?? reviewer?.name;
    return reviewer && login
      ? [
          {
            login,
            avatarUrl: reviewer.avatarUrl ?? null,
            isTeam: reviewer.__typename === "Team",
            state: "requested" as const,
          },
        ]
      : [];
  });

const reviewThreadsOf = (pr: RawPullRequest): PullRequestViewReviewThread[] =>
  itemsOf(pr.reviewThreads).map((thread) => {
    const comments = itemsOf(thread.comments);
    return {
      id: thread.id,
      path: thread.path,
      line: thread.line ?? null,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      diffHunk: comments[0]?.diffHunk ?? null,
      comments: comments.map((comment) => ({
        id: comment.id,
        author: comment.author ? userOf(comment.author) : null,
        body: comment.body,
        createdAt: comment.createdAt,
        url: comment.url ?? null,
      })),
    };
  });
