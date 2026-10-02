import { describe, expect, test } from "bun:test";
import { type PullRequestListQueryInput, PullRequestListQuerySchema } from "@aop/common";
import { pageOf, selectPullRequests } from "./filter.ts";
import type { ListedPullRequest } from "./mapping.ts";

const pull = (
  number: number,
  overrides: Partial<ListedPullRequest["item"]> = {},
  involved: string[] = [],
): ListedPullRequest => ({
  item: {
    repoId: "repo_shop",
    repo: "acme/shop",
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/shop/pull/${number}`,
    state: "open",
    author: { login: "ada", avatarUrl: null },
    labels: [],
    assignees: [],
    review: null,
    checks: null,
    headRefName: `branch-${number}`,
    baseRefName: "main",
    createdAt: `2026-09-${String(number).padStart(2, "0")}T00:00:00Z`,
    updatedAt: `2026-09-${String(number).padStart(2, "0")}T00:00:00Z`,
    comments: 0,
    ...overrides,
  },
  involved,
});

const numbers = (pulls: readonly ListedPullRequest[], query: PullRequestListQueryInput = {}) =>
  selectPullRequests(pulls, PullRequestListQuerySchema.parse(query), "ada").matching.map(
    ({ item }) => item.number,
  );

const BUG = { name: "bug", color: "d73a4a" };
const UI = { name: "ui", color: "0e8a16" };

describe("selecting pull requests", () => {
  const pulls = [
    pull(1, { state: "open" }),
    pull(2, { state: "draft" }),
    pull(3, { state: "merged" }),
    pull(4, { state: "closed" }),
  ];

  test.each([
    ["open", [2, 1]],
    ["closed", [4]],
    ["merged", [3]],
    ["all", [4, 3, 2, 1]],
  ] as const)("state %s (drafts are open)", (state, expected) => {
    expect(numbers(pulls, { state })).toEqual([...expected]);
  });

  test("authors and assignees match any chosen, case-insensitively", () => {
    const list = [
      pull(1, { author: { login: "ada", avatarUrl: null } }),
      pull(2, { author: { login: "Grace", avatarUrl: null } }),
      pull(3, { author: null, assignees: [{ login: "ken", avatarUrl: null }] }),
    ];
    expect(numbers(list, { author: ["ada", "grace"] })).toEqual([2, 1]);
    expect(numbers(list, { assignee: ["KEN"] })).toEqual([3]);
    expect(numbers(list, { author: ["ada"], assignee: ["ken"] })).toEqual([]);
  });

  test("labels match all chosen, as on GitHub", () => {
    const list = [pull(1, { labels: [BUG] }), pull(2, { labels: [BUG, UI] }), pull(3)];
    expect(numbers(list, { label: ["bug"] })).toEqual([2, 1]);
    expect(numbers(list, { label: ["bug", "ui"] })).toEqual([2]);
  });

  test("involves me keeps what the viewer wrote, is assigned or reviews", () => {
    const list = [pull(1, {}, ["ada"]), pull(2, {}, ["grace", "ada"]), pull(3, {}, ["grace"])];
    expect(numbers(list, { involves: true })).toEqual([2, 1]);
  });

  test("search matches every word in the title, number, branch, repo or author", () => {
    const list = [
      pull(1, { title: "Fix the checkout button" }),
      pull(2, { headRefName: "feature/checkout-v2" }),
      pull(12, { title: "Docs" }),
      pull(3, { title: "Other", repo: "acme/web" }),
    ];
    expect(numbers(list, { q: "checkout" })).toEqual([2, 1]);
    expect(numbers(list, { q: "checkout BUTTON" })).toEqual([1]);
    expect(numbers(list, { q: "#12" })).toEqual([12]);
    expect(numbers(list, { q: "acme/web" })).toEqual([3]);
  });

  test("sorts by update, creation or comments, either way", () => {
    const list = [
      pull(1, { updatedAt: "2026-09-30T00:00:00Z", comments: 5 }),
      pull(2, { comments: 9 }),
      pull(3, { comments: 0 }),
    ];
    expect(numbers(list, { sort: "updated" })).toEqual([1, 3, 2]);
    expect(numbers(list, { sort: "least-updated" })).toEqual([2, 3, 1]);
    expect(numbers(list, { sort: "newest" })).toEqual([3, 2, 1]);
    expect(numbers(list, { sort: "oldest" })).toEqual([1, 2, 3]);
    expect(numbers(list, { sort: "most-commented" })).toEqual([2, 1, 3]);
    expect(numbers(list, { sort: "least-commented" })).toEqual([3, 1, 2]);
  });

  test("the filters' choices count the pull requests of the chosen state, most used first", () => {
    const list = [
      pull(1, { labels: [BUG], assignees: [{ login: "ken", avatarUrl: "https://a/ken" }] }),
      pull(2, { labels: [BUG, UI], author: { login: "grace", avatarUrl: null } }),
      pull(3, { state: "merged", labels: [UI], author: { login: "linus", avatarUrl: null } }),
    ];
    const { facets } = selectPullRequests(
      list,
      PullRequestListQuerySchema.parse({ label: ["ui"] }),
      "ada",
    );
    expect(facets).toEqual({
      authors: [
        { value: "ada", count: 1, avatarUrl: null, color: null },
        { value: "grace", count: 1, avatarUrl: null, color: null },
      ],
      labels: [
        { value: "bug", count: 2, avatarUrl: null, color: "d73a4a" },
        { value: "ui", count: 1, avatarUrl: null, color: "0e8a16" },
      ],
      assignees: [{ value: "ken", count: 1, avatarUrl: "https://a/ken", color: null }],
    });
  });
});

describe("pageOf", () => {
  const items = [1, 2, 3, 4, 5];

  test("hands out a cursor until the last page", () => {
    expect(pageOf(items, undefined, 2)).toEqual({ page: [1, 2], nextCursor: "2" });
    expect(pageOf(items, "2", 2)).toEqual({ page: [3, 4], nextCursor: "4" });
    expect(pageOf(items, "4", 2)).toEqual({ page: [5], nextCursor: null });
  });

  test("a cursor that is not a number starts over", () => {
    expect(pageOf(items, "junk", 5)).toEqual({ page: items, nextCursor: null });
  });
});
