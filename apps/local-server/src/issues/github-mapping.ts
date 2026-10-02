import type {
  IssuePerson,
  IssueStateFilter,
  LinkedPullRequest,
  LinkedPullRequestChecks,
  ProjectIssue,
} from "@aop/common";

/**
 * One page of a repository's issues, newest update first, with the pull requests linked to each
 * (GitHub's Development links, which "Fixes #12" also makes) and their head commit's checks.
 * The states are spliced in from a fixed set, so no caller text reaches the query. One page costs
 * a single point of the GraphQL rate limit.
 */
export const githubIssuesQuery = (state: IssueStateFilter): string => `
query($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: $first, after: $after, states: ${GRAPHQL_STATES[state]}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url state stateReason createdAt updatedAt
        author { login avatarUrl ... on User { name } }
        assignees(first: 5) { nodes { login name avatarUrl } }
        labels(first: 10) { nodes { name color } }
        milestone { title }
        comments { totalCount }
        closedByPullRequestsReferences(first: 5, includeClosedPrs: true) {
          nodes {
            number title url state isDraft
            repository { nameWithOwner }
            commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
          }
        }
      }
    }
  }
}`;

/** One issue with its body, for the brief of a thread started from it. */
export const GITHUB_ISSUE_BODY_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { number title url body }
  }
}`;

const GRAPHQL_STATES: Record<IssueStateFilter, string> = {
  open: "[OPEN]",
  closed: "[CLOSED]",
  all: "[OPEN, CLOSED]",
};

export interface GithubIssuePage {
  issues: GithubIssueNode[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/** Reads one page out of a GraphQL answer's `data`; null when it is not that shape. */
export const parseGithubIssuePage = (data: unknown): GithubIssuePage | null => {
  const issues = (data as IssuesData | null)?.repository?.issues;
  if (!issues || !Array.isArray(issues.nodes)) return null;
  return {
    issues: issues.nodes.filter((node): node is GithubIssueNode => node !== null),
    hasNextPage: issues.pageInfo?.hasNextPage === true,
    endCursor: issues.pageInfo?.endCursor ?? null,
  };
};

/**
 * A GitHub issue as the Issues tab shows it. `repos` maps `owner/name` (lowercase) to the
 * project's repository ids, so a linked pull request in one of them can open in the PR View.
 */
export const mapGithubIssue = (
  node: GithubIssueNode,
  repo: { repoId: string; nameWithOwner: string },
  repos: ReadonlyMap<string, string>,
): ProjectIssue => {
  const standing = githubStanding(node);
  return {
    key: `github:${repo.nameWithOwner}#${node.number}`,
    source: "github",
    repoId: repo.repoId,
    container: repo.nameWithOwner,
    identifier: `#${node.number}`,
    title: node.title,
    url: node.url,
    ...standing,
    stateColor: null,
    labels: nodesOf(node.labels).map((label) => ({ name: label.name, color: hexOf(label.color) })),
    assignees: nodesOf(node.assignees).map(person),
    author: node.author ? person(node.author) : null,
    milestone: node.milestone?.title ?? null,
    commentCount: node.comments?.totalCount ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    linkedPullRequests: nodesOf(node.closedByPullRequestsReferences).map((pr) =>
      linkedPullRequest(pr, repos),
    ),
  };
};

const githubStanding = (
  node: GithubIssueNode,
): Pick<ProjectIssue, "state" | "stage" | "stateName"> => {
  if (node.state !== "CLOSED") return { state: "open", stage: "unstarted", stateName: "Open" };
  return node.stateReason === "NOT_PLANNED"
    ? { state: "closed", stage: "canceled", stateName: "Not planned" }
    : { state: "closed", stage: "completed", stateName: "Closed" };
};

const person = (actor: GithubActor): IssuePerson => ({
  login: actor.login,
  name: actor.name || null,
  avatarUrl: actor.avatarUrl || null,
});

const linkedPullRequest = (
  pr: GithubPullRequestNode,
  repos: ReadonlyMap<string, string>,
): LinkedPullRequest => {
  const nameWithOwner = pr.repository?.nameWithOwner ?? "";
  return {
    repoId: repos.get(nameWithOwner.toLowerCase()) ?? null,
    nameWithOwner,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pullRequestState(pr),
    checks: checksOf(nodesOf(pr.commits)[0]?.commit?.statusCheckRollup?.state),
  };
};

const pullRequestState = (pr: GithubPullRequestNode): LinkedPullRequest["state"] => {
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  return pr.isDraft ? "draft" : "open";
};

const CHECKS: Record<string, LinkedPullRequestChecks> = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "pending",
  EXPECTED: "pending",
};

const checksOf = (state: string | null | undefined): LinkedPullRequestChecks =>
  CHECKS[state ?? ""] ?? null;

const hexOf = (color: string | null): string | null =>
  color && /^[0-9a-fA-F]{6}$/.test(color) ? color : null;

const nodesOf = <T>(connection: { nodes?: (T | null)[] | null } | null | undefined): T[] =>
  (connection?.nodes ?? []).filter((node): node is T => node !== null);

interface GithubActor {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

interface GithubPullRequestNode {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  repository?: { nameWithOwner: string } | null;
  commits?: { nodes?: ({ commit?: { statusCheckRollup?: { state: string } | null } } | null)[] };
}

export interface GithubIssueNode {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  stateReason: string | null;
  createdAt: string;
  updatedAt: string;
  author: GithubActor | null;
  assignees?: { nodes?: (GithubActor | null)[] | null };
  labels?: { nodes?: ({ name: string; color: string | null } | null)[] | null };
  milestone: { title: string } | null;
  comments?: { totalCount: number };
  closedByPullRequestsReferences?: { nodes?: (GithubPullRequestNode | null)[] | null };
}

interface IssuesData {
  repository?: {
    issues?: {
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      nodes?: (GithubIssueNode | null)[];
    };
  } | null;
}
