import type { RawCheckContext, RawCommit, RawPullRequest, RawRepo } from "./queries.ts";

/** A repository whose settings allow every merge method, as GitHub's GraphQL answers it. */
export const rawRepo = (overrides: Partial<RawRepo> = {}): RawRepo => ({
  viewerPermission: "ADMIN",
  mergeCommitAllowed: true,
  squashMergeAllowed: true,
  rebaseMergeAllowed: true,
  ...overrides,
});

export const checkRun = (
  name: string,
  status = "COMPLETED",
  conclusion: string | null = "SUCCESS",
  extra: Partial<Extract<RawCheckContext, { __typename: "CheckRun" }>> = {},
): RawCheckContext => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/acme/app/actions/runs/1/job/${name}`,
  startedAt: "2026-10-01T10:00:00Z",
  completedAt: status === "COMPLETED" ? "2026-10-01T10:05:00Z" : null,
  isRequired: false,
  checkSuite: { workflowRun: { workflow: { name: "build" } }, app: { name: "GitHub Actions" } },
  ...extra,
});

export const rawCommit = (oid: string, headline = `commit ${oid}`): RawCommit => ({
  oid: oid.padEnd(40, "0"),
  abbreviatedOid: oid.slice(0, 7),
  messageHeadline: headline,
  committedDate: "2026-10-01T09:00:00Z",
  url: `https://github.com/acme/app/commit/${oid}`,
  authors: { nodes: [{ name: "Ada", user: { login: "ada", avatarUrl: null } }] },
  statusCheckRollup: { state: "SUCCESS" },
});

/** An open pull request with one passing check, as the detail query answers it. */
export const rawPullRequest = (
  overrides: Partial<RawPullRequest> & { contexts?: RawCheckContext[] } = {},
): RawPullRequest => {
  const { contexts = [checkRun("test")], ...rest } = overrides;
  return {
    number: 7,
    title: "Make checkout faster",
    url: "https://github.com/acme/app/pull/7",
    state: "OPEN",
    isDraft: false,
    headRefOid: "a".repeat(40),
    baseRefName: "main",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    headCommit: {
      nodes: [
        {
          commit: {
            oid: "a".repeat(40),
            statusCheckRollup: { state: "SUCCESS", contexts: { nodes: contexts } },
          },
        },
      ],
    },
    body: "Why: it is slow.",
    createdAt: "2026-10-01T08:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    mergedAt: null,
    closedAt: null,
    author: { login: "ada", avatarUrl: "https://avatars.example/ada" },
    headRefName: "fast-checkout",
    isCrossRepository: false,
    headRepositoryOwner: { login: "acme" },
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    labels: { nodes: [{ name: "perf", color: "a2eeef" }] },
    assignees: { nodes: [] },
    milestone: null,
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [] },
    closingIssuesReferences: { nodes: [] },
    comments: { totalCount: 0 },
    commits: { totalCount: 1, nodes: [{ commit: rawCommit("aaaaaaa", "Make checkout faster") }] },
    reviewThreads: { nodes: [] },
    timelineItems: { totalCount: 0, nodes: [] },
    ...rest,
  };
};
