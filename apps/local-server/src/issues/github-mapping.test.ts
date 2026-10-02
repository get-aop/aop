import { describe, expect, test } from "bun:test";
import { githubIssuesQuery, mapGithubIssue, parseGithubIssuePage } from "./github-mapping.ts";
import { githubNode } from "./test-utils.ts";

const repo = { repoId: "repo_1", nameWithOwner: "acme/app" };
const projectRepos = new Map([["acme/app", "repo_1"]]);

const pr = (overrides: Record<string, unknown>) => ({
  number: 40,
  title: "Fix it",
  url: "https://github.com/acme/app/pull/40",
  state: "OPEN" as const,
  isDraft: false,
  repository: { nameWithOwner: "acme/app" },
  commits: { nodes: [] },
  ...overrides,
});

describe("mapGithubIssue", () => {
  test("an open issue is the project's, keyed by repository and number", () => {
    const issue = mapGithubIssue(githubNode(), repo, projectRepos);
    expect(issue).toMatchObject({
      key: "github:acme/app#12",
      source: "github",
      repoId: "repo_1",
      container: "acme/app",
      identifier: "#12",
      state: "open",
      stage: "unstarted",
      stateName: "Open",
      author: { login: "ada", name: "Ada", avatarUrl: "https://avatars.example/ada" },
      commentCount: 0,
    });
  });

  test("a closed issue is done, or canceled when it was not planned", () => {
    const done = mapGithubIssue(
      githubNode({ state: "CLOSED", stateReason: "COMPLETED" }),
      repo,
      projectRepos,
    );
    const notPlanned = mapGithubIssue(
      githubNode({ state: "CLOSED", stateReason: "NOT_PLANNED" }),
      repo,
      projectRepos,
    );
    expect([done.state, done.stage, done.stateName]).toEqual(["closed", "completed", "Closed"]);
    expect([notPlanned.state, notPlanned.stage, notPlanned.stateName]).toEqual([
      "closed",
      "canceled",
      "Not planned",
    ]);
  });

  test("labels keep a valid colour only; assignees, milestone and comments come through", () => {
    const issue = mapGithubIssue(
      githubNode({
        labels: { nodes: [{ name: "bug", color: "d73a4a" }, { name: "odd", color: "red" }, null] },
        assignees: { nodes: [{ login: "bo", name: "", avatarUrl: "" }] },
        milestone: { title: "v1" },
        comments: { totalCount: 4 },
      }),
      repo,
      projectRepos,
    );
    expect(issue.labels).toEqual([
      { name: "bug", color: "d73a4a" },
      { name: "odd", color: null },
    ]);
    expect(issue.assignees).toEqual([{ login: "bo", name: null, avatarUrl: null }]);
    expect(issue.milestone).toBe("v1");
    expect(issue.commentCount).toBe(4);
  });

  test("linked pull requests carry state, checks and the project's repository when they are in it", () => {
    const issue = mapGithubIssue(
      githubNode({
        closedByPullRequestsReferences: {
          nodes: [
            pr({ commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }),
            pr({
              number: 41,
              isDraft: true,
              commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
            }),
            pr({
              number: 42,
              state: "MERGED",
              commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
            }),
            pr({ number: 7, state: "CLOSED", repository: { nameWithOwner: "Acme/Other" } }),
          ],
        },
      }),
      repo,
      projectRepos,
    );
    expect(
      issue.linkedPullRequests.map(({ number, state, checks, repoId }) => ({
        number,
        state,
        checks,
        repoId,
      })),
    ).toEqual([
      { number: 40, state: "open", checks: "failing", repoId: "repo_1" },
      { number: 41, state: "draft", checks: "pending", repoId: "repo_1" },
      { number: 42, state: "merged", checks: "passing", repoId: "repo_1" },
      { number: 7, state: "closed", checks: null, repoId: null },
    ]);
  });
});

describe("the issues query", () => {
  test("asks for the states of the filter, newest update first", () => {
    expect(githubIssuesQuery("open")).toContain("states: [OPEN]");
    expect(githubIssuesQuery("closed")).toContain("states: [CLOSED]");
    expect(githubIssuesQuery("all")).toContain("states: [OPEN, CLOSED]");
    expect(githubIssuesQuery("all")).toContain("orderBy: {field: UPDATED_AT, direction: DESC}");
  });

  test("a page is read out of the answer's data, and anything else is not a page", () => {
    const page = parseGithubIssuePage({
      repository: {
        issues: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [githubNode(), null] },
      },
    });
    expect(page?.issues).toHaveLength(1);
    expect(page?.hasNextPage).toBe(true);
    expect(page?.endCursor).toBe("c1");
    expect(parseGithubIssuePage({ repository: null })).toBeNull();
    expect(parseGithubIssuePage(null)).toBeNull();
  });
});
