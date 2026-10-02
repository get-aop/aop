import { describe, expect, test } from "bun:test";
import { GraphqlPullRequestSchema } from "./graphql.ts";
import { toListedPullRequest } from "./mapping.ts";
import { makeNode } from "./test-utils.ts";

const REPO = { repoId: "repo_shop", nameWithOwner: "acme/shop" };
const map = (overrides: Record<string, unknown> = {}) =>
  toListedPullRequest(REPO, GraphqlPullRequestSchema.parse(makeNode(overrides)));

const rollup = (
  state: string,
  runs: Record<string, number>,
  statuses: Record<string, number> = {},
) => ({
  nodes: [
    {
      commit: {
        statusCheckRollup: {
          state,
          contexts: {
            checkRunCountsByState: Object.entries(runs).map(([s, count]) => ({ state: s, count })),
            statusContextCountsByState: Object.entries(statuses).map(([s, count]) => ({
              state: s,
              count,
            })),
          },
        },
      },
    },
  ],
});

describe("a GraphQL pull request as a row", () => {
  test("carries what the row shows", () => {
    const { item } = map({
      labels: {
        nodes: [
          { name: "bug", color: "d73a4a" },
          { name: "odd", color: "not-hex" },
        ],
      },
      assignees: { nodes: [{ login: "grace", avatarUrl: "https://avatars.example/grace" }] },
      comments: { totalCount: 4 },
    });

    expect(item).toEqual({
      repoId: "repo_shop",
      repo: "acme/shop",
      number: 1,
      title: "Add checkout",
      url: "https://github.com/acme/shop/pull/1",
      state: "open",
      author: { login: "ada", avatarUrl: "https://avatars.example/ada" },
      labels: [{ name: "bug", color: "d73a4a" }],
      assignees: [{ login: "grace", avatarUrl: "https://avatars.example/grace" }],
      review: null,
      checks: null,
      headRefName: "feature/checkout",
      baseRefName: "main",
      createdAt: "2026-09-01T10:00:00Z",
      updatedAt: "2026-09-02T10:00:00Z",
      comments: 4,
    });
  });

  test.each([
    [{ state: "OPEN", isDraft: false }, "open"],
    [{ state: "OPEN", isDraft: true }, "draft"],
    [{ state: "MERGED" }, "merged"],
    [{ state: "CLOSED" }, "closed"],
  ])("state %p is %s", (overrides, expected) => {
    expect(map(overrides).item.state).toBe(expected as never);
  });

  test.each([
    ["APPROVED", "approved"],
    ["CHANGES_REQUESTED", "changes-requested"],
    ["REVIEW_REQUIRED", "review-required"],
    [null, null],
  ])("review decision %p is %p", (reviewDecision, expected) => {
    expect(map({ reviewDecision }).item.review).toBe(expected as never);
  });

  test("checks add up check runs and commit statuses", () => {
    const { item } = map({
      commits: rollup(
        "FAILURE",
        { SUCCESS: 3, SKIPPED: 1, FAILURE: 1, IN_PROGRESS: 2, STALE: 4 },
        { SUCCESS: 1, ERROR: 1 },
      ),
    });
    expect(item.checks).toEqual({ state: "failure", successful: 5, failing: 2, pending: 2 });
  });

  test("checks still running are pending, all done and green is success", () => {
    expect(map({ commits: rollup("PENDING", { SUCCESS: 2, QUEUED: 1 }) }).item.checks).toEqual({
      state: "pending",
      successful: 2,
      failing: 0,
      pending: 1,
    });
    expect(map({ commits: rollup("SUCCESS", { SUCCESS: 2 }) }).item.checks?.state).toBe("success");
  });

  test("a non-http avatar is dropped, so the client never renders it", () => {
    expect(map({ author: { login: "eve", avatarUrl: "javascript:alert(1)" } }).item.author).toEqual(
      {
        login: "eve",
        avatarUrl: null,
      },
    );
    expect(map({ author: null }).item.author).toBeNull();
  });

  test("involves its author, assignees, requested reviewers and reviewers, once each", () => {
    const { involved } = map({
      assignees: { nodes: [{ login: "grace" }, { login: "ada" }] },
      reviewRequests: {
        nodes: [{ requestedReviewer: { login: "linus" } }, { requestedReviewer: {} }],
      },
      latestOpinionatedReviews: { nodes: [{ author: { login: "ken" } }, { author: null }] },
    });
    expect(involved).toEqual(["ada", "grace", "linus", "ken"]);
  });
});
