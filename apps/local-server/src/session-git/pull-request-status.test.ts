import { describe, expect, test } from "bun:test";
import { getSessionPullRequestState, getSessionPullRequestStatus } from "./pull-request-status.ts";
import {
  createFakeGit,
  createPrWorkflowGh,
  failResult,
  okResult,
  setupPrSession,
  teardownPrSession,
  unavailableGh,
} from "./test-utils.ts";

const prListJson = (state: "OPEN" | "CLOSED" | "MERGED") =>
  JSON.stringify([
    {
      number: 8,
      url: "https://github.com/acme/widget/pull/8",
      state,
      title: "Session PR",
      mergeable: "MERGEABLE",
      baseRefName: "main",
      headRefName: "feature/x",
    },
  ]);

const check = (state: string, bucket: string) => ({
  name: "ci",
  workflow: "AOP CI",
  state,
  bucket,
  link: "https://github.com/acme/widget/actions/runs/1",
  startedAt: null,
  completedAt: null,
  description: null,
});

const statusGh = (config: {
  listJson: string;
  checksJson?: string;
  checksFailsWith?: string;
  viewJson?: string;
}) =>
  createPrWorkflowGh({
    "pr list": okResult(config.listJson),
    "pr checks": config.checksFailsWith
      ? failResult(config.checksFailsWith)
      : okResult(config.checksJson ?? "[]"),
    ...(config.viewJson ? { "pr view": okResult(config.viewJson) } : {}),
  });

describe("getSessionPullRequestState", () => {
  test.each([
    ["OPEN", "open"],
    ["CLOSED", "closed"],
    ["MERGED", "merged"],
  ] as const)("maps %s without loading checks or merged details", async (prState, expected) => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = statusGh({ listJson: prListJson(prState) });

    const result = await getSessionPullRequestState(ctx, sessionId, gh.run, git.run);

    expect(result).toEqual({ success: true, status: { state: expected } });
    expect(gh.calls.some((args) => args[0] === "pr" && args[1] === "checks")).toBe(false);
    expect(gh.calls.some((args) => args[0] === "pr" && args[1] === "view")).toBe(false);

    await teardownPrSession(db, repoPath);
  });

  test("returns null without querying GitHub on the default branch", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ branch: "main" });
    const gh = statusGh({ listJson: prListJson("MERGED") });

    const result = await getSessionPullRequestState(ctx, sessionId, gh.run, git.run);

    expect(result).toEqual({ success: true, status: { state: null } });
    expect(gh.calls).toEqual([]);

    await teardownPrSession(db, repoPath);
  });
});

describe("getSessionPullRequestStatus", () => {
  test("returns an empty status when the branch has no pull request", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = statusGh({ listJson: "[]" });

    const result = await getSessionPullRequestStatus(ctx, sessionId, gh.run, git.run);

    expect(result).toEqual({
      success: true,
      status: { pr: null, checksState: null, checks: [], merged: null },
    });

    await teardownPrSession(db, repoPath);
  });

  test("does not associate a historical pull request with a session on the default branch", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ branch: "main" });
    const gh = statusGh({ listJson: prListJson("MERGED") });

    const result = await getSessionPullRequestStatus(ctx, sessionId, gh.run, git.run);

    expect(result).toEqual({
      success: true,
      status: { pr: null, checksState: null, checks: [], merged: null },
    });
    expect(gh.calls.some((args) => args[0] === "pr" && args[1] === "list")).toBe(false);

    await teardownPrSession(db, repoPath);
  });

  test.each([
    ["pending", "IN_PROGRESS", "pending"],
    ["passing", "SUCCESS", "pass"],
    ["failing", "FAILURE", "fail"],
  ] as const)("reports %s checks for an open PR", async (_label, state, bucket) => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = statusGh({
      listJson: prListJson("OPEN"),
      checksJson: JSON.stringify([check(state, bucket)]),
    });

    const result = await getSessionPullRequestStatus(ctx, sessionId, gh.run, git.run);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.status.pr).toEqual({
      number: 8,
      url: "https://github.com/acme/widget/pull/8",
      title: "Session PR",
      state: "OPEN",
      mergeable: "MERGEABLE",
      baseRefName: "main",
      headRefName: "feature/x",
    });
    const expected = { IN_PROGRESS: "pending", SUCCESS: "success", FAILURE: "failure" }[state];
    expect(result.status.checksState).toBe(expected as "pending" | "success" | "failure");
    expect(result.status.checks).toHaveLength(1);
    expect(result.status.merged).toBeNull();

    await teardownPrSession(db, repoPath);
  });

  test("reports no checks state when the branch has no CI at all", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = statusGh({
      listJson: prListJson("OPEN"),
      checksFailsWith: "no checks reported",
    });

    const result = await getSessionPullRequestStatus(ctx, sessionId, gh.run, git.run);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.status.pr?.state).toBe("OPEN");
    // Repos without CI: null — never an eternal pending that blocks merging.
    expect(result.status.checksState).toBeNull();
    expect(result.status.checks).toEqual([]);

    await teardownPrSession(db, repoPath);
  });

  test("returns no checks state for a closed PR", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = statusGh({ listJson: prListJson("CLOSED") });

    const result = await getSessionPullRequestStatus(ctx, sessionId, gh.run, git.run);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.status.pr?.state).toBe("CLOSED");
    expect(result.status.checksState).toBeNull();
    expect(result.status.checks).toEqual([]);
    expect(result.status.merged).toBeNull();

    await teardownPrSession(db, repoPath);
  });

  test("populates merged detail for a merged PR", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = statusGh({
      listJson: prListJson("MERGED"),
      viewJson: JSON.stringify({
        number: 8,
        url: "https://github.com/acme/widget/pull/8",
        title: "Session PR",
        state: "MERGED",
        author: { login: "octo" },
        additions: 21,
        deletions: 4,
        changedFiles: 6,
        mergedAt: "2026-07-18T09:30:00Z",
      }),
    });

    const result = await getSessionPullRequestStatus(ctx, sessionId, gh.run, git.run);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.status.pr?.state).toBe("MERGED");
    expect(result.status.checksState).toBeNull();
    expect(result.status.merged).toEqual({
      number: 8,
      url: "https://github.com/acme/widget/pull/8",
      title: "Session PR",
      authorLogin: "octo",
      additions: 21,
      deletions: 4,
      changedFiles: 6,
      mergedAt: "2026-07-18T09:30:00Z",
      repoNameWithOwner: "acme/widget",
    });

    await teardownPrSession(db, repoPath);
  });

  test("maps malformed merged-PR JSON to GH_UNAVAILABLE", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = statusGh({ listJson: prListJson("MERGED"), viewJson: "not-json{" });

    const result = await getSessionPullRequestStatus(ctx, sessionId, gh.run, git.run);

    expect(result).toEqual({
      success: false,
      error: {
        code: "GH_UNAVAILABLE",
        message: "GitHub CLI returned malformed pull request JSON",
      },
    });

    await teardownPrSession(db, repoPath);
  });

  test("returns GH_UNAVAILABLE when gh auth fails", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();

    const result = await getSessionPullRequestStatus(ctx, sessionId, unavailableGh, git.run);

    expect(result).toEqual({
      success: false,
      error: { code: "GH_UNAVAILABLE", message: "gh not logged in" },
    });

    await teardownPrSession(db, repoPath);
  });

  test("returns SESSION_NOT_FOUND for an unknown session", async () => {
    const { db, ctx, repoPath } = await setupPrSession();
    const git = createFakeGit();

    const result = await getSessionPullRequestStatus(ctx, "csess_missing", unavailableGh, git.run);

    expect(result).toEqual({ success: false, error: { code: "SESSION_NOT_FOUND" } });

    await teardownPrSession(db, repoPath);
  });
});
