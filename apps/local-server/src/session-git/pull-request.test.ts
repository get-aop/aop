import { describe, expect, test } from "bun:test";
import { createSessionPullRequest, mergeSessionPullRequest } from "./pull-request.ts";
import {
  createFakeGit,
  createPrWorkflowGh,
  failResult,
  okResult,
  setupPrSession,
  teardownPrSession,
  unavailableGh,
} from "./test-utils.ts";

const openPrListJson = (number: number) =>
  JSON.stringify([
    {
      number,
      url: `https://github.com/acme/widget/pull/${number}`,
      state: "OPEN",
      title: "Existing PR",
      mergeable: "MERGEABLE",
      baseRefName: "main",
      headRefName: "feature/x",
    },
  ]);

describe("createSessionPullRequest", () => {
  test("commits dirty changes, pushes, and creates a PR through gh", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ dirty: true });
    const gh = createPrWorkflowGh({
      "pr list": okResult("[]"),
      "pr create": okResult("https://github.com/acme/widget/pull/123\n"),
    });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "create" },
      gh.run,
      git.run,
    );

    expect(result).toEqual({
      success: true,
      result: {
        number: 123,
        url: "https://github.com/acme/widget/pull/123",
        state: "OPEN",
        created: true,
      },
    });
    expect(git.calls).toContainEqual(["add", "-A"]);
    expect(git.calls).toContainEqual(["commit", "-m", "chore(session): Session PR test"]);
    expect(git.calls).toContainEqual(["push", "-u", "origin", "feature/x"]);
    expect(gh.calls).toContainEqual(["auth", "status"]);
    expect(gh.calls).toContainEqual([
      "pr",
      "create",
      "--title",
      "Session PR test",
      "--body",
      "Created from an AOP chat session.",
      "--base",
      "main",
      "--head",
      "feature/x",
    ]);

    await teardownPrSession(db, repoPath);
  });

  test("skips the auto-commit when the working tree is clean", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ dirty: false });
    const gh = createPrWorkflowGh({
      "pr list": okResult("[]"),
      "pr create": okResult("https://github.com/acme/widget/pull/9\n"),
    });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "create" },
      gh.run,
      git.run,
    );

    expect(result.success).toBe(true);
    expect(git.calls).not.toContainEqual(["add", "-A"]);
    expect(git.calls.some((args) => args[0] === "commit")).toBe(false);
    expect(git.calls).toContainEqual(["push", "-u", "origin", "feature/x"]);

    await teardownPrSession(db, repoPath);
  });

  test("passes --draft for draft mode", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = createPrWorkflowGh({
      "pr list": okResult("[]"),
      "pr create": okResult("https://github.com/acme/widget/pull/44\n"),
    });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "draft" },
      gh.run,
      git.run,
    );

    expect(result.success).toBe(true);
    const createCall = gh.calls.find((args) => args[0] === "pr" && args[1] === "create");
    expect(createCall?.at(-1)).toBe("--draft");

    await teardownPrSession(db, repoPath);
  });

  test("refuses to create a PR from the default branch", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ branch: "main" });
    const gh = createPrWorkflowGh();

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "create" },
      gh.run,
      git.run,
    );

    expect(result).toEqual({ success: false, error: { code: "ON_DEFAULT_BRANCH" } });
    expect(gh.calls).toEqual([]);

    await teardownPrSession(db, repoPath);
  });

  test("returns GH_UNAVAILABLE when gh auth fails", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "create" },
      unavailableGh,
      git.run,
    );

    expect(result).toEqual({
      success: false,
      error: { code: "GH_UNAVAILABLE", message: "gh not logged in" },
    });

    await teardownPrSession(db, repoPath);
  });

  test("short-circuits on an existing open PR without creating a duplicate", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ dirty: true });
    const gh = createPrWorkflowGh({ "pr list": okResult(openPrListJson(55)) });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "create" },
      gh.run,
      git.run,
    );

    expect(result).toEqual({
      success: true,
      result: {
        number: 55,
        url: "https://github.com/acme/widget/pull/55",
        state: "OPEN",
        created: false,
      },
    });
    expect(gh.calls.some((args) => args[0] === "pr" && args[1] === "create")).toBe(false);
    expect(git.calls.some((args) => args[0] === "push")).toBe(false);

    await teardownPrSession(db, repoPath);
  });

  test("manual mode builds a compare URL from an ssh remote", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ remoteUrl: "git@github.com:acme/widget.git" });
    const gh = createPrWorkflowGh({ "pr list": okResult("[]") });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "manual" },
      gh.run,
      git.run,
    );

    expect(result).toEqual({
      success: true,
      result: {
        compareUrl: "https://github.com/acme/widget/compare/main...feature/x?expand=1",
        created: false,
      },
    });

    await teardownPrSession(db, repoPath);
  });

  test("manual mode builds a compare URL from an https remote", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ remoteUrl: "https://github.com/acme/widget.git" });
    const gh = createPrWorkflowGh({ "pr list": okResult("[]") });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "manual" },
      gh.run,
      git.run,
    );

    expect(result).toEqual({
      success: true,
      result: {
        compareUrl: "https://github.com/acme/widget/compare/main...feature/x?expand=1",
        created: false,
      },
    });

    await teardownPrSession(db, repoPath);
  });

  test("manual mode rejects a non-GitHub origin remote", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ remoteUrl: "git@gitlab.com:acme/widget.git" });
    const gh = createPrWorkflowGh({ "pr list": okResult("[]") });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "manual" },
      gh.run,
      git.run,
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: "PR_CREATE_FAILED",
        message: "The origin remote is not a GitHub repository",
      },
    });

    await teardownPrSession(db, repoPath);
  });

  test("returns PUSH_FAILED with stderr when the push is rejected", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ pushFails: true });
    const gh = createPrWorkflowGh({ "pr list": okResult("[]") });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "create" },
      gh.run,
      git.run,
    );

    expect(result).toEqual({
      success: false,
      error: { code: "PUSH_FAILED", message: "push rejected" },
    });

    await teardownPrSession(db, repoPath);
  });

  test("returns SESSION_NOT_FOUND for an unknown session", async () => {
    const { db, ctx, repoPath } = await setupPrSession();
    const git = createFakeGit();

    const result = await createSessionPullRequest(
      ctx,
      "csess_missing",
      { mode: "create" },
      unavailableGh,
      git.run,
    );

    expect(result).toEqual({ success: false, error: { code: "SESSION_NOT_FOUND" } });

    await teardownPrSession(db, repoPath);
  });

  test("refuses to auto-commit on the user's main checkout", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ dirty: true, mainCheckout: true });
    const gh = createPrWorkflowGh({ "pr list": okResult("[]") });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "create" },
      gh.run,
      git.run,
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: "DIRTY_MAIN_CHECKOUT",
        message: "Workspace has uncommitted changes — create a worktree first",
      },
    });
    expect(git.calls.some((args) => args[0] === "add")).toBe(false);
    expect(git.calls.some((args) => args[0] === "commit")).toBe(false);
    expect(git.calls.some((args) => args[0] === "push")).toBe(false);

    await teardownPrSession(db, repoPath);
  });

  test("manual mode also refuses to auto-commit on the main checkout", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ dirty: true, mainCheckout: true });
    const gh = createPrWorkflowGh({ "pr list": okResult("[]") });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "manual" },
      gh.run,
      git.run,
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("DIRTY_MAIN_CHECKOUT");
    expect(git.calls.some((args) => args[0] === "add")).toBe(false);

    await teardownPrSession(db, repoPath);
  });

  test("a clean main checkout pushes without committing", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit({ dirty: false, mainCheckout: true });
    const gh = createPrWorkflowGh({
      "pr list": okResult("[]"),
      "pr create": okResult("https://github.com/acme/widget/pull/21\n"),
    });

    const result = await createSessionPullRequest(
      ctx,
      sessionId,
      { mode: "create" },
      gh.run,
      git.run,
    );

    expect(result.success).toBe(true);
    expect(git.calls.some((args) => args[0] === "commit")).toBe(false);
    expect(git.calls).toContainEqual(["push", "-u", "origin", "feature/x"]);

    await teardownPrSession(db, repoPath);
  });
});

describe("mergeSessionPullRequest", () => {
  const mergedViewJson = JSON.stringify({
    number: 55,
    url: "https://github.com/acme/widget/pull/55",
    title: "Existing PR",
    state: "MERGED",
    author: { login: "octo" },
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    mergedAt: "2026-07-18T10:00:00Z",
    baseRefName: "main",
    headRefName: "feature/x",
  });

  const openViewJson = JSON.stringify({
    number: 55,
    url: "https://github.com/acme/widget/pull/55",
    title: "Existing PR",
    state: "OPEN",
    author: { login: "octo" },
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    mergedAt: null,
    baseRefName: "main",
    headRefName: "feature/x",
  });

  const mergeScriptedGh = () =>
    createPrWorkflowGh({
      "pr list": okResult(openPrListJson(55)),
      "pr merge": okResult(),
      "pr view": okResult(mergedViewJson),
    });

  test("squash merges by default and returns the refreshed merged status", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = mergeScriptedGh();

    const result = await mergeSessionPullRequest(ctx, sessionId, {}, gh.run, git.run);

    expect(gh.calls).toContainEqual(["pr", "merge", "55", "--squash"]);
    expect(gh.calls.flat()).not.toContain("--delete-branch");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.status.pr?.state).toBe("MERGED");
    expect(result.status.checksState).toBeNull();
    expect(result.status.merged).toEqual({
      number: 55,
      url: "https://github.com/acme/widget/pull/55",
      title: "Existing PR",
      authorLogin: "octo",
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      mergedAt: "2026-07-18T10:00:00Z",
      repoNameWithOwner: "acme/widget",
    });

    await teardownPrSession(db, repoPath);
  });

  test.each(["merge", "rebase"] as const)("passes --%s for an explicit method", async (method) => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = mergeScriptedGh();

    const result = await mergeSessionPullRequest(ctx, sessionId, { method }, gh.run, git.run);

    expect(result.success).toBe(true);
    expect(gh.calls).toContainEqual(["pr", "merge", "55", `--${method}`]);
    expect(gh.calls.flat()).not.toContain("--delete-branch");

    await teardownPrSession(db, repoPath);
  });

  test("maps a mergeability failure to NOT_MERGEABLE", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = createPrWorkflowGh({
      "pr list": okResult(openPrListJson(55)),
      "pr merge": failResult("GraphQL: Pull request is not mergeable (merge conflict)"),
    });

    const result = await mergeSessionPullRequest(ctx, sessionId, {}, gh.run, git.run);

    expect(result).toEqual({
      success: false,
      error: {
        code: "NOT_MERGEABLE",
        message: "GraphQL: Pull request is not mergeable (merge conflict)",
      },
    });

    await teardownPrSession(db, repoPath);
  });

  test("maps a required status-check failure to CHECKS_FAILING", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = createPrWorkflowGh({
      "pr list": okResult(openPrListJson(55)),
      "pr merge": failResult("GraphQL: Required status check has not passed"),
    });

    const result = await mergeSessionPullRequest(ctx, sessionId, {}, gh.run, git.run);

    expect(result).toEqual({
      success: false,
      error: {
        code: "CHECKS_FAILING",
        message: "GraphQL: Required status check has not passed",
      },
    });

    await teardownPrSession(db, repoPath);
  });

  test("maps other merge failures to MERGE_FAILED", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = createPrWorkflowGh({
      "pr list": okResult(openPrListJson(55)),
      "pr merge": failResult("network exploded"),
    });

    const result = await mergeSessionPullRequest(ctx, sessionId, {}, gh.run, git.run);

    expect(result).toEqual({
      success: false,
      error: { code: "MERGE_FAILED", message: "network exploded" },
    });

    await teardownPrSession(db, repoPath);
  });

  test("returns NO_OPEN_PR when the branch has no open pull request", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = createPrWorkflowGh({ "pr list": okResult("[]") });

    const result = await mergeSessionPullRequest(ctx, sessionId, {}, gh.run, git.run);

    expect(result).toEqual({ success: false, error: { code: "NO_OPEN_PR" } });

    await teardownPrSession(db, repoPath);
  });

  test("returns GH_UNAVAILABLE when gh auth fails", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();

    const result = await mergeSessionPullRequest(ctx, sessionId, {}, unavailableGh, git.run);

    expect(result).toEqual({
      success: false,
      error: { code: "GH_UNAVAILABLE", message: "gh not logged in" },
    });

    await teardownPrSession(db, repoPath);
  });
  test("confirms a lagging merge via pr view retries", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = createPrWorkflowGh({
      "pr list": okResult(openPrListJson(55)),
      "pr merge": okResult(),
      "pr view": [okResult(openViewJson), okResult(mergedViewJson)],
    });

    const result = await mergeSessionPullRequest(ctx, sessionId, {}, gh.run, git.run, {
      confirmDelayMs: 0,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.status.pr?.state).toBe("MERGED");
    expect(result.status.merged?.number).toBe(55);
    const viewCalls = gh.calls.filter((args) => args[0] === "pr" && args[1] === "view");
    expect(viewCalls).toHaveLength(2);

    await teardownPrSession(db, repoPath);
  });

  test("a successful merge stays a success even when confirmation keeps lagging", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = createPrWorkflowGh({
      "pr list": okResult(openPrListJson(55)),
      "pr merge": okResult(),
      "pr view": okResult(openViewJson),
    });

    const result = await mergeSessionPullRequest(ctx, sessionId, {}, gh.run, git.run, {
      confirmAttempts: 2,
      confirmDelayMs: 0,
    });

    // Falls back to a plain status refresh; never a reported failure.
    expect(result.success).toBe(true);

    await teardownPrSession(db, repoPath);
  });

  test("generic failures containing 'check' are MERGE_FAILED, not NOT_MERGEABLE", async () => {
    const { db, ctx, repoPath, sessionId } = await setupPrSession();
    const git = createFakeGit();
    const gh = createPrWorkflowGh({
      "pr list": okResult(openPrListJson(55)),
      "pr merge": failResult("GraphQL: check suite timed out while merging"),
    });

    const result = await mergeSessionPullRequest(ctx, sessionId, {}, gh.run, git.run);

    expect(result).toEqual({
      success: false,
      error: { code: "MERGE_FAILED", message: "GraphQL: check suite timed out while merging" },
    });

    await teardownPrSession(db, repoPath);
  });
});
