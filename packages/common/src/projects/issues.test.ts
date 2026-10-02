import { describe, expect, test } from "bun:test";
import {
  IssueListQuerySchema,
  LinearConnectInputSchema,
  LinkedPullRequestSchema,
  ProjectIssueSchema,
} from "./issues.ts";

const issue = {
  key: "github:acme/app#1",
  source: "github",
  repoId: "repo_1",
  container: "acme/app",
  identifier: "#1",
  title: "T",
  url: "https://github.com/acme/app/issues/1",
  state: "open",
  stage: "unstarted",
  stateName: "Open",
  stateColor: null,
  labels: [{ name: "bug", color: "d73a4a" }],
  assignees: [],
  author: null,
  milestone: null,
  commentCount: 0,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  linkedPullRequests: [],
};

describe("issue wire types", () => {
  test("an issue parses, and a link the client could not safely render does not", () => {
    expect(ProjectIssueSchema.parse(issue).identifier).toBe("#1");
    expect(ProjectIssueSchema.safeParse({ ...issue, url: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(
      LinkedPullRequestSchema.safeParse({
        repoId: null,
        nameWithOwner: "a/b",
        number: 1,
        title: "",
        url: "data:text/html,x",
        state: "open",
        checks: null,
      }).success,
    ).toBe(false);
  });

  test("a label colour is six hex digits or null", () => {
    expect(
      ProjectIssueSchema.safeParse({ ...issue, labels: [{ name: "x", color: "#fff" }] }).success,
    ).toBe(false);
  });

  test("the list query defaults to open issues, one page, from the host's cache", () => {
    expect(IssueListQuerySchema.parse({})).toEqual({ state: "open", limit: 100, refresh: false });
    expect(IssueListQuerySchema.parse({ state: "closed", limit: "250", refresh: "1" })).toEqual({
      state: "closed",
      limit: 250,
      refresh: true,
    });
    expect(IssueListQuerySchema.safeParse({ limit: "1001" }).success).toBe(false);
  });

  test("connecting Linear needs a team or project; the key is optional and trimmed", () => {
    const scope = { kind: "team" as const, id: "t1", name: "Eng" };
    expect(LinearConnectInputSchema.parse({ apiKey: "  lin_api_x ", scope })).toEqual({
      apiKey: "lin_api_x",
      scope,
    });
    expect(LinearConnectInputSchema.safeParse({ scope: { ...scope, kind: "org" } }).success).toBe(
      false,
    );
  });
});
