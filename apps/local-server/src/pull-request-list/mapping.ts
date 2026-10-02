import type {
  GithubLabel,
  GithubUser,
  PullRequestChecks,
  PullRequestListItem,
  PullRequestListItemState,
  PullRequestReviewState,
} from "@aop/common";
import type { GraphqlPullRequest } from "./graphql.ts";

/** A pull request as the host keeps it between reads: the row, and who it involves. */
export interface ListedPullRequest {
  item: Omit<PullRequestListItem, "threadId">;
  /** Logins of its author, assignees, requested reviewers and reviewers, for "involves me". */
  involved: readonly string[];
}

/** One GraphQL node of `repo` as a row of the list. */
export const toListedPullRequest = (
  repo: { repoId: string; nameWithOwner: string },
  node: GraphqlPullRequest,
): ListedPullRequest => {
  const author = node.author ? toUser(node.author) : null;
  const assignees = node.assignees.map(toUser);
  const requested = node.reviewRequests.flatMap(
    (request) => request.requestedReviewer?.login ?? [],
  );
  const reviewers = node.latestOpinionatedReviews.flatMap((review) => review.author?.login ?? []);
  return {
    item: {
      repoId: repo.repoId,
      repo: repo.nameWithOwner,
      number: node.number,
      title: node.title,
      url: node.url,
      state: itemState(node),
      author,
      labels: node.labels.flatMap(toLabel),
      assignees,
      review: REVIEW_STATES[node.reviewDecision ?? ""] ?? null,
      checks: checksOf(node),
      headRefName: node.headRefName,
      baseRefName: node.baseRefName,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      comments: node.comments?.totalCount ?? 0,
    },
    involved: [
      ...new Set([
        ...(author ? [author.login] : []),
        ...assignees.map((user) => user.login),
        ...requested,
        ...reviewers,
      ]),
    ],
  };
};

const itemState = (node: GraphqlPullRequest): PullRequestListItemState => {
  if (node.state === "MERGED") return "merged";
  if (node.state === "CLOSED") return "closed";
  return node.isDraft ? "draft" : "open";
};

const REVIEW_STATES: Record<string, PullRequestReviewState> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "review-required",
};

// Only an http(s) avatar reaches the client, which renders it as an <img src>.
const toUser = (user: { login: string; avatarUrl?: string | null }): GithubUser => ({
  login: user.login,
  avatarUrl: user.avatarUrl && /^https?:\/\//i.test(user.avatarUrl) ? user.avatarUrl : null,
});

const toLabel = (label: { name: string; color: string }): GithubLabel[] =>
  label.name && /^[0-9a-f]{6}$/i.test(label.color)
    ? [{ name: label.name, color: label.color }]
    : [];

// Check runs by status/conclusion, and commit statuses by state, as GitHub counts them.
const PASSING = new Set(["SUCCESS", "NEUTRAL", "SKIPPED", "COMPLETED"]);
const FAILING = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

/** The head commit's checks added up; null when it has none (or GitHub keeps no rollup). */
const checksOf = (node: GraphqlPullRequest): PullRequestChecks | null => {
  const rollup = node.commits[0]?.commit.statusCheckRollup;
  if (!rollup) return null;
  const tally = tallyChecks([
    ...(rollup.contexts?.checkRunCountsByState ?? []),
    ...(rollup.contexts?.statusContextCountsByState ?? []),
  ]);
  return { state: rollupState(rollup.state, tally), ...tally };
};

const tallyChecks = (counts: readonly { state: string; count: number }[]) => {
  const tally = { successful: 0, failing: 0, pending: 0 };
  for (const { state, count } of counts) {
    if (count <= 0 || state === "STALE") continue;
    if (PASSING.has(state)) tally.successful += count;
    else if (FAILING.has(state)) tally.failing += count;
    else tally.pending += count;
  }
  return tally;
};

const rollupState = (
  state: string,
  tally: { failing: number; pending: number },
): PullRequestChecks["state"] => {
  if (state === "FAILURE" || state === "ERROR" || tally.failing > 0) return "failure";
  if (state === "PENDING" || state === "EXPECTED" || tally.pending > 0) return "pending";
  return "success";
};
