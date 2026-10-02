import { describe, expect, test } from "bun:test";
import { checksOf } from "./checks.ts";
import { checksPartOf, detailOf } from "./detail.ts";
import { NO_RULES } from "./rules.ts";
import { checkRun, rawCommit, rawPullRequest, rawRepo } from "./test-utils.ts";
import { timelineOf } from "./timeline.ts";

const context = {
  repoId: "repo_1",
  nameWithOwner: "acme/app",
  repo: rawRepo(),
  rules: NO_RULES,
  viewer: { canWrite: true, readOnlyReason: null, login: "ada" },
  fetchedAt: "2026-10-02T00:00:00.000Z",
};

describe("checksOf", () => {
  test("puts every kind of check in one vocabulary, failing first", () => {
    const checks = checksOf(
      rawPullRequest({
        contexts: [
          checkRun("ok"),
          checkRun("skipped", "COMPLETED", "SKIPPED"),
          checkRun("queued", "QUEUED", null),
          checkRun("running", "IN_PROGRESS", null),
          checkRun("timed out", "COMPLETED", "TIMED_OUT"),
          checkRun("stale", "COMPLETED", "STALE"),
          {
            __typename: "StatusContext",
            context: "ci/legacy",
            state: "PENDING",
            targetUrl: "https://ci.example/1",
            description: "Running",
            createdAt: "2026-10-01T10:00:00Z",
            isRequired: true,
          },
        ],
      }),
    );
    expect(checks.items.map((check) => [check.name, check.status])).toEqual([
      ["timed out", "failure"],
      ["stale", "cancelled"],
      ["ci/legacy", "in_progress"],
      ["running", "in_progress"],
      ["queued", "queued"],
      ["ok", "success"],
      ["skipped", "skipped"],
    ]);
    expect(checks).toMatchObject({
      state: "failure",
      total: 7,
      successful: 1,
      failing: 2,
      pending: 3,
      skipped: 1,
    });
    expect(checks.items.find((check) => check.name === "ci/legacy")).toMatchObject({
      workflow: null,
      required: true,
      url: "https://ci.example/1",
      description: "Running",
    });
  });

  test("no checks at all is `none`, not success", () => {
    expect(checksOf(rawPullRequest({ contexts: [] })).state).toBe("none");
    expect(checksOf({ headCommit: { nodes: [] } }).state).toBe("none");
  });
});

describe("timelineOf", () => {
  test("folds consecutive commits into one entry and keeps comments, reviews and events in order", () => {
    const items = timelineOf([
      { __typename: "PullRequestCommit", commit: rawCommit("1111111") },
      { __typename: "PullRequestCommit", commit: rawCommit("2222222") },
      {
        __typename: "IssueComment",
        id: "c1",
        body: "Looks good",
        createdAt: "2026-10-01T11:00:00Z",
        url: "https://github.com/acme/app/pull/7#issuecomment-1",
        author: { login: "bob", avatarUrl: null },
      },
      {
        __typename: "PullRequestReview",
        id: "r1",
        state: "CHANGES_REQUESTED",
        body: "",
        submittedAt: "2026-10-01T12:00:00Z",
        author: { login: "carol", avatarUrl: null },
      },
      { __typename: "PullRequestCommit", commit: rawCommit("3333333") },
      {
        __typename: "LabeledEvent",
        createdAt: "2026-10-01T13:00:00Z",
        actor: { login: "ada" },
        label: { name: "perf", color: "a2eeef" },
      },
      {
        __typename: "RenamedTitleEvent",
        createdAt: "2026-10-01T14:00:00Z",
        actor: { login: "ada" },
        previousTitle: "Old",
        currentTitle: "New",
      },
      {
        __typename: "MergedEvent",
        createdAt: "2026-10-01T15:00:00Z",
        actor: { login: "ada" },
        commit: { abbreviatedOid: "abc1234" },
      },
      { __typename: "SomethingNew", createdAt: "2026-10-01T16:00:00Z" },
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      "commits",
      "comment",
      "review",
      "commits",
      "event",
      "event",
      "event",
    ]);
    expect(items[0]).toMatchObject({ commits: [{ shortSha: "1111111" }, { shortSha: "2222222" }] });
    expect(items[2]).toMatchObject({
      state: "changes_requested",
      createdAt: "2026-10-01T12:00:00Z",
    });
    expect(items[4]).toMatchObject({ event: "labeled", actor: "ada", label: { name: "perf" } });
    expect(items[5]).toMatchObject({ event: "renamed", subject: "Old → New" });
    expect(items[6]).toMatchObject({ event: "merged", subject: "abc1234" });
  });
});

describe("detailOf", () => {
  test("maps the header, the sidebar and the merge box", () => {
    const detail = detailOf(
      rawPullRequest({
        isCrossRepository: true,
        headRepositoryOwner: { login: "fork-owner" },
        latestReviews: {
          nodes: [
            { state: "APPROVED", author: { login: "bob", avatarUrl: null } },
            { state: "COMMENTED", author: { login: "carol", avatarUrl: null } },
          ],
        },
        // Asked again after commenting: carol is back to requested.
        reviewRequests: {
          nodes: [
            { requestedReviewer: { __typename: "User", login: "carol", avatarUrl: null } },
            { requestedReviewer: { __typename: "Team", name: "core" } },
          ],
        },
        closingIssuesReferences: {
          nodes: [
            {
              number: 3,
              title: "Slow checkout",
              url: "https://github.com/acme/app/issues/3",
              state: "OPEN",
            },
          ],
        },
        milestone: { title: "v1", url: "https://github.com/acme/app/milestone/1", dueOn: null },
        reviewThreads: {
          nodes: [
            {
              id: "t1",
              isResolved: false,
              isOutdated: false,
              path: "src/a.ts",
              line: 4,
              comments: {
                nodes: [
                  {
                    id: "rc1",
                    body: "Why?",
                    createdAt: "2026-10-01T10:00:00Z",
                    url: null,
                    diffHunk: "@@ -1 +1 @@",
                    author: { login: "bob", avatarUrl: null },
                  },
                ],
              },
            },
          ],
        },
      }),
      context,
    );
    expect(detail).toMatchObject({
      repoId: "repo_1",
      nameWithOwner: "acme/app",
      number: 7,
      state: "open",
      headLabel: "fork-owner:fast-checkout",
      baseRefName: "main",
      commitCount: 1,
      labels: [{ name: "perf", color: "a2eeef" }],
      linkedIssues: [{ number: 3, state: "open" }],
      milestone: { title: "v1" },
      merge: { status: "ready" },
      viewer: { canWrite: true },
    });
    expect(detail.reviewers).toEqual([
      { login: "bob", avatarUrl: null, isTeam: false, state: "approved" },
      { login: "carol", avatarUrl: null, isTeam: false, state: "requested" },
      { login: "core", avatarUrl: null, isTeam: true, state: "requested" },
    ]);
    expect(detail.reviewThreads).toEqual([
      {
        id: "t1",
        path: "src/a.ts",
        line: 4,
        isResolved: false,
        isOutdated: false,
        diffHunk: "@@ -1 +1 @@",
        comments: [
          {
            id: "rc1",
            author: { login: "bob", avatarUrl: null },
            body: "Why?",
            createdAt: "2026-10-01T10:00:00Z",
            url: null,
          },
        ],
      },
    ]);
  });

  test("the polled part computes the same merge box as the full page", () => {
    const pr = rawPullRequest({ mergeStateStatus: "BEHIND" });
    const part = checksPartOf(pr, context);
    expect(part.merge).toEqual(detailOf(pr, context).merge);
    expect(part).toMatchObject({ state: "open", headSha: "a".repeat(40) });
  });
});
