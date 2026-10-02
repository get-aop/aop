import type {
  PullRequestListItem,
  PullRequestListQueryInput,
  PullRequestListResponse,
} from "@aop/common";

export const makePull = (overrides: Partial<PullRequestListItem> = {}): PullRequestListItem => ({
  repoId: "repo_shop",
  repo: "acme/shop",
  number: 1,
  title: "Fix checkout rounding",
  url: "https://github.com/acme/shop/pull/1",
  state: "open",
  author: { login: "ada", avatarUrl: null },
  labels: [],
  assignees: [],
  review: null,
  checks: null,
  headRefName: "fix/rounding",
  baseRefName: "main",
  createdAt: "2026-09-29T08:00:00.000Z",
  updatedAt: "2026-09-29T09:00:00.000Z",
  comments: 0,
  threadId: null,
  ...overrides,
});

export const readyList = (
  items: PullRequestListItem[],
  overrides: Partial<Extract<PullRequestListResponse, { status: "ready" }>> = {},
): PullRequestListResponse => ({
  status: "ready",
  viewerLogin: "ada",
  repos: [
    {
      repoId: "repo_shop",
      name: "shop",
      nameWithOwner: "acme/shop",
      error: null,
      truncated: false,
    },
  ],
  items,
  total: items.length,
  nextCursor: null,
  facets: {
    authors: [
      { value: "ada", count: 2, avatarUrl: null, color: null },
      { value: "grace", count: 1, avatarUrl: null, color: null },
    ],
    labels: [{ value: "bug", count: 1, avatarUrl: null, color: "d73a4a" }],
    assignees: [{ value: "ken", count: 1, avatarUrl: null, color: null }],
  },
  fetchedAt: "2026-09-29T09:59:00.000Z",
  ...overrides,
});

/** A host whose answers a test sets, keeping every query it was asked. */
export const fakeListHost = (
  answer: (query: PullRequestListQueryInput) => PullRequestListResponse | Error,
) => {
  const queries: PullRequestListQueryInput[] = [];
  const list = async (_projectId: string, query: PullRequestListQueryInput) => {
    queries.push(query);
    const result = answer(query);
    if (result instanceof Error) throw result;
    return result;
  };
  return { list, queries, last: () => queries.at(-1) };
};
