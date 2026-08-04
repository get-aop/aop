import { describe, expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import type { RunGh } from "../github-cli/index.ts";
import { createSessionGitRoutes, type SessionGitRouteDeps } from "./routes.ts";
import { createFakeGit, createPrWorkflowGh, failResult, okResult } from "./test-utils.ts";

/** Tests must never call the real gh CLI; default to "gh unavailable". */
const unavailableGh: RunGh = async () => ({ exitCode: 1, stdout: "", stderr: "gh not logged in" });

const setup = async (deps: SessionGitRouteDeps = { runGh: unavailableGh }) => {
  const db = await createTestDb();
  const ctx = createCommandContext(db);
  const repoPath = join(tmpdir(), `aop-session-git-route-${crypto.randomUUID()}`);
  await mkdir(repoPath, { recursive: true });
  await createTestRepo(db, "repo_session_git_route", repoPath);

  const now = new Date().toISOString();
  const session = await ctx.chatSessionRepository.create({
    id: `csess_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    repo_id: "repo_session_git_route",
    title: "Route git status",
    named: false,
    runtime: "claude-code",
    model: "claude-opus-4-8",
    reasoning_effort: "medium",
    runtime_alias: null,
    runtime_session_id: null,
    runtime_configuration_id: null,
    fast_mode: false,
    pinned: false,
    settled_override: null,
    settled_at: null,
    default_worker_id: null,
    default_workflow_id: null,
    workspace_path: null,
    created_at: now,
    updated_at: now,
  });

  const app = new Hono();
  app.route("/api/chat-sessions", createSessionGitRoutes(ctx, deps));
  return { db, app, repoPath, sessionId: session.id };
};

const teardown = async (db: Awaited<ReturnType<typeof createTestDb>>, repoPath: string) => {
  await db.destroy();
  await rm(repoPath, { recursive: true, force: true });
};

describe("session-git routes", () => {
  test("GET /:sessionId/git/status returns git status for a dirty workspace", async () => {
    const { db, app, repoPath, sessionId } = await setup();
    await writeFile(join(repoPath, "note.txt"), "line one\n");

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      isGitRepo: true,
      branch: "main",
      defaultBranch: "main",
      isOnDefaultBranch: true,
      dirty: true,
      diffstat: { filesChanged: 1, additions: 1, deletions: 0 },
      aheadOfBase: 0,
      ghAvailable: false,
      pr: null,
      prState: null,
    });

    await teardown(db, repoPath);
  });

  test("GET /:sessionId/git/branches lists refs and POST validates the branch", async () => {
    const { db, app, repoPath, sessionId } = await setup();

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/branches`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      branches: [
        {
          name: "main",
          isCurrent: true,
          isDefault: true,
          worktreePath: await realpath(repoPath),
        },
      ],
    });

    const invalid = await app.request(`/api/chat-sessions/${sessionId}/git/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      code: "INVALID_BRANCH",
      message: "branch must be a string",
    });

    await teardown(db, repoPath);
  });

  test("GET /:sessionId/git/status returns 404 for an unknown session", async () => {
    const { db, app, repoPath } = await setup();

    const response = await app.request("/api/chat-sessions/csess_missing/git/status");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found" });

    await teardown(db, repoPath);
  });

  test("GET /:sessionId/git/diff returns a summary; file endpoint returns hunks", async () => {
    const { db, app, repoPath, sessionId } = await setup();
    await writeFile(join(repoPath, "route-diff.ts"), "export const routeDiff = true;\n");

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/diff`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      defaultBranch: string | null;
      files: Array<{ path: string; status: string; detailsPending?: boolean; hunks: unknown[] }>;
      perFileLineCap: number;
      summaryOnly?: boolean;
    };
    expect(body.defaultBranch).toBe("main");
    expect(body.summaryOnly).toBe(true);
    expect(body.files).toContainEqual(
      expect.objectContaining({
        path: "route-diff.ts",
        status: "added",
        detailsPending: true,
        hunks: [],
      }),
    );
    expect(body.perFileLineCap).toBe(2000);

    const fileResponse = await app.request(
      `/api/chat-sessions/${sessionId}/git/diff/file?path=${encodeURIComponent("route-diff.ts")}`,
    );
    expect(fileResponse.status).toBe(200);
    const file = (await fileResponse.json()) as {
      path: string;
      detailsPending?: boolean;
      hunks: Array<{ lines: unknown[] }>;
    };
    expect(file.path).toBe("route-diff.ts");
    expect(file.detailsPending).toBeUndefined();
    expect(file.hunks.length).toBeGreaterThan(0);
    expect(file.hunks[0]?.lines.length).toBeGreaterThan(0);

    await teardown(db, repoPath);
  });

  test("GET /:sessionId/git/diff returns 404 for an unknown session", async () => {
    const { db, app, repoPath } = await setup();

    const response = await app.request("/api/chat-sessions/csess_missing/git/diff");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found" });

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/commit stages and commits session changes", async () => {
    const fakeGit = createFakeGit({ dirty: true });
    const { db, app, repoPath, sessionId } = await setup({
      runGh: unavailableGh,
      runGit: fakeGit.run,
    });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ push: false }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ committed: true, pushed: false });
    expect(fakeGit.calls).toContainEqual(["add", "-A"]);
    expect(fakeGit.calls).toContainEqual(["commit", "-m", "chore(session): Route git status"]);

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/commit pushes with an explicit refspec", async () => {
    const fakeGit = createFakeGit({ dirty: true, branch: "feature/commit" });
    const { db, app, repoPath, sessionId } = await setup({
      runGh: unavailableGh,
      runGit: fakeGit.run,
    });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ push: true }),
    });
    expect(response.status).toBe(200);
    expect(fakeGit.calls).toContainEqual([
      "push",
      "-u",
      "origin",
      "HEAD:refs/heads/feature/commit",
    ]);

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/commit distinguishes clean trees and main checkouts", async () => {
    const clean = await setup({ runGh: unavailableGh, runGit: createFakeGit().run });
    const cleanResponse = await clean.app.request(
      `/api/chat-sessions/${clean.sessionId}/git/commit`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    expect(cleanResponse.status).toBe(409);
    expect((await cleanResponse.json()) as object).toMatchObject({ code: "NO_CHANGES" });
    await teardown(clean.db, clean.repoPath);

    const main = await setup({
      runGh: unavailableGh,
      runGit: createFakeGit({ dirty: true, mainCheckout: true }).run,
    });
    const mainResponse = await main.app.request(`/api/chat-sessions/${main.sessionId}/git/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(mainResponse.status).toBe(409);
    expect((await mainResponse.json()) as object).toMatchObject({ code: "DIRTY_MAIN_CHECKOUT" });
    await teardown(main.db, main.repoPath);
  });

  test("POST /:sessionId/worktree creates a worktree and binds the session", async () => {
    const { db, app, repoPath, sessionId } = await setup();

    const response = await app.request(`/api/chat-sessions/${sessionId}/worktree`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchName: "aop/route-worktree" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      worktree: { path: string; branch: string; baseBranch: string };
      session: { id: string; workspacePath: string };
    };
    expect(body.worktree.branch).toBe("aop/route-worktree");
    expect(body.session.id).toBe(sessionId);
    expect(body.session.workspacePath).toBe(body.worktree.path);
    expect(body.worktree.path.length).toBeGreaterThan(0);

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/worktree returns 404 for an unknown session", async () => {
    const { db, app, repoPath } = await setup();

    const response = await app.request("/api/chat-sessions/csess_missing/worktree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(404);

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/pr rejects an invalid mode", async () => {
    const { db, app, repoPath, sessionId } = await setup();

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "yolo" }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("INVALID_MODE");

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/pr on the default branch returns 409 ON_DEFAULT_BRANCH", async () => {
    const { db, app, repoPath, sessionId } = await setup();

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "create" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "ON_DEFAULT_BRANCH",
      message: "Create a worktree first",
    });

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/pr creates a pull request through gh", async () => {
    const fakeGit = createFakeGit().run;
    const fakeGh = createPrWorkflowGh({
      "pr list": okResult("[]"),
      "pr create": okResult("https://github.com/acme/widget/pull/7\n"),
    }).run;
    const { db, app, repoPath, sessionId } = await setup({ runGh: fakeGh, runGit: fakeGit });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "create" }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      number: 7,
      url: "https://github.com/acme/widget/pull/7",
      state: "OPEN",
      created: true,
    });

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/pr manual mode returns the compare URL", async () => {
    const fakeGit = createFakeGit().run;
    const fakeGh = createPrWorkflowGh({ "pr list": okResult("[]") }).run;
    const { db, app, repoPath, sessionId } = await setup({ runGh: fakeGh, runGit: fakeGit });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "manual" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      compareUrl: "https://github.com/acme/widget/compare/main...feature/x?expand=1",
      created: false,
    });

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/pr refuses to auto-commit a dirty main checkout", async () => {
    const fakeGit = createFakeGit({ dirty: true, mainCheckout: true }).run;
    const fakeGh = createPrWorkflowGh({ "pr list": okResult("[]") }).run;
    const { db, app, repoPath, sessionId } = await setup({ runGh: fakeGh, runGit: fakeGit });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "create" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "DIRTY_MAIN_CHECKOUT",
      message: "Workspace has uncommitted changes — create a worktree first",
    });

    await teardown(db, repoPath);
  });

  test("GET /:sessionId/git/pr/status returns 503 when gh is unavailable", async () => {
    const { db, app, repoPath, sessionId } = await setup({
      runGh: unavailableGh,
      runGit: createFakeGit().run,
    });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr/status`);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe("GH_UNAVAILABLE");

    await teardown(db, repoPath);
  });

  test("GET /:sessionId/git/pr/status returns PR and check state", async () => {
    const fakeGit = createFakeGit().run;
    const fakeGh = createPrWorkflowGh({
      "pr list": okResult(
        JSON.stringify([
          {
            number: 55,
            url: "https://github.com/acme/widget/pull/55",
            title: "Route PR",
            state: "OPEN",
            mergeable: "MERGEABLE",
            baseRefName: "main",
            headRefName: "feature/x",
          },
        ]),
      ),
      "pr checks": okResult(
        JSON.stringify([
          {
            name: "unit",
            workflow: "CI",
            state: "SUCCESS",
            bucket: "pass",
            link: "https://github.com/acme/widget/actions/1",
            startedAt: null,
            completedAt: null,
            description: null,
          },
        ]),
      ),
    }).run;
    const { db, app, repoPath, sessionId } = await setup({ runGh: fakeGh, runGit: fakeGit });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr/status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      pr: { number: number; mergeable: string };
      checksState: string;
      checks: Array<{ name: string }>;
    };
    expect(body.pr).toMatchObject({ number: 55, mergeable: "MERGEABLE" });
    expect(body.checksState).toBe("success");
    expect(body.checks).toHaveLength(1);

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/pr/merge without an open PR returns 409 NO_OPEN_PR", async () => {
    const fakeGit = createFakeGit().run;
    const fakeGh: RunGh = async (args) => {
      if (args[0] === "auth") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[0] === "pr" && args[1] === "list") return { exitCode: 0, stdout: "[]", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unexpected gh call" };
    };
    const { db, app, repoPath, sessionId } = await setup({ runGh: fakeGh, runGit: fakeGit });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("NO_OPEN_PR");

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/pr/merge rejects an invalid method", async () => {
    const { db, app, repoPath, sessionId } = await setup();

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "fast-forward" }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("INVALID_METHOD");

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/pr/merge returns 409 CHECKS_FAILING for required checks", async () => {
    const fakeGit = createFakeGit().run;
    const fakeGh = createPrWorkflowGh({
      "pr list": okResult(
        JSON.stringify([
          {
            number: 55,
            url: "https://github.com/acme/widget/pull/55",
            title: "Route PR",
            state: "OPEN",
            mergeable: "MERGEABLE",
            baseRefName: "main",
            headRefName: "feature/x",
          },
        ]),
      ),
      "pr merge": failResult("GraphQL: Required status check has not passed"),
    }).run;
    const { db, app, repoPath, sessionId } = await setup({ runGh: fakeGh, runGit: fakeGit });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("CHECKS_FAILING");

    await teardown(db, repoPath);
  });

  test("POST /:sessionId/git/pr/merge returns the merged PR status", async () => {
    const fakeGit = createFakeGit().run;
    const fakeGh = createPrWorkflowGh({
      "pr list": okResult(
        JSON.stringify([
          {
            number: 55,
            url: "https://github.com/acme/widget/pull/55",
            title: "Route PR",
            state: "OPEN",
            mergeable: "MERGEABLE",
            baseRefName: "main",
            headRefName: "feature/x",
          },
        ]),
      ),
      "pr merge": okResult(),
      "pr view": okResult(
        JSON.stringify({
          number: 55,
          url: "https://github.com/acme/widget/pull/55",
          title: "Route PR",
          state: "MERGED",
          author: { login: "octocat" },
          additions: 4,
          deletions: 1,
          changedFiles: 2,
          mergedAt: "2026-07-18T10:00:00Z",
          baseRefName: "main",
          headRefName: "feature/x",
        }),
      ),
    }).run;
    const { db, app, repoPath, sessionId } = await setup({ runGh: fakeGh, runGit: fakeGit });

    const response = await app.request(`/api/chat-sessions/${sessionId}/git/pr/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "rebase" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      pr: { state: string };
      merged: { number: number; authorLogin: string };
    };
    expect(body.pr.state).toBe("MERGED");
    expect(body.merged).toMatchObject({ number: 55, authorLogin: "octocat" });

    await teardown(db, repoPath);
  });
});

/** Fake git seam simulating a clean feature branch with a GitHub origin. */
