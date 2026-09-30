import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import { type Kysely, sql } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo } from "../db/test-utils.ts";
import { insertProjectSession, projectSettings } from "../project/test-utils.ts";
import { resolveCheckpointWorkspaceIdentity } from "../session-git/checkpoints.ts";
import { DEFAULT_SETTINGS, SettingKey } from "../settings/types.ts";
import { resetAllRuntimeData } from "./handlers.ts";
import { createRepoRoutes } from "./routes.ts";

const requireWorkspaceIdentity = async (workspacePath: string) => {
  const identity = await resolveCheckpointWorkspaceIdentity({ workspacePath });
  if (!identity.success)
    throw new Error(`Failed to resolve ${workspacePath}: ${identity.error.message}`);
  return identity.value;
};

describe("repo/routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/repos", createRepoRoutes(ctx));
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  describe("POST /api/repos", () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = join(tmpdir(), `aop-test-repo-${Date.now()}`);
      mkdirSync(testRepoPath, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testRepoPath)) {
        rmSync(testRepoPath, { recursive: true });
      }
    });

    test("returns 400 when path is missing", async () => {
      const res = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required field: path");
    });

    test("returns 400 when path is not a git repo", async () => {
      const res = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: testRepoPath }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Not a git repository");
      expect(body.path).toBe(testRepoPath);
    });

    test("registers a new repo successfully", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const res = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: testRepoPath }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.repoId).toBeDefined();
      expect(body.alreadyExists).toBe(false);
    });

    test("returns existing repo when already registered", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const firstRes = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: testRepoPath }),
      });
      const firstBody: AnyJson = await firstRes.json();

      const secondRes = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: testRepoPath }),
      });
      const secondBody: AnyJson = await secondRes.json();

      expect(secondRes.status).toBe(200);
      expect(secondBody.repoId).toBe(firstBody.repoId);
      expect(secondBody.alreadyExists).toBe(true);
    });
  });

  describe("DELETE /api/repos/:id", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("removes repo successfully", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.repoId).toBe("repo-1");
    });

    test("refuses to remove a repo that a project uses, and deletes none of its threads", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo-1");
      const project = await ctx.projectRepository.create({
        id: "proj_1",
        ...projectSettings({ name: "Checkout", repoIds: ["repo-1"] }),
      });
      await insertProjectSession(
        db,
        { id: "isess_thread", projectId: project.id, kind: "thread" },
        { repo_id: "repo-1" },
      );

      const res = await app.request("/api/repos/repo-1", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body).toMatchObject({
        error: "Remove the repository from its projects first",
        projects: ["Checkout"],
      });
      expect(await db.selectFrom("repos").select("id").execute()).toEqual([{ id: "repo-1" }]);
      expect(await db.selectFrom("chat_sessions").select("id").execute()).toEqual([
        { id: "isess_thread" },
      ]);
    });

    test("does not factory-reset while a repo-less project exists", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo-1");
      await ctx.projectRepository.create({ id: "proj_1", ...projectSettings({ repoIds: [] }) });
      await ctx.settingsRepository.set(SettingKey.CHAT_GLOBAL_INSTRUCTIONS, "keep me");

      const res = await app.request("/api/repos/repo-1", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, repoId: "repo-1", factoryReset: false });
      expect(await ctx.projectRepository.list()).toHaveLength(1);
      expect(await ctx.settingsRepository.get(SettingKey.CHAT_GLOBAL_INSTRUCTIONS)).toBe("keep me");
    });

    test("purges repo-owned chat rows and files without touching other repos", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo-1");
      await createTestRepo(db, "repo-2", "/path/to/repo-2");

      await db
        .insertInto("chat_sessions")
        .values({
          id: "chat-1",
          repo_id: "repo-1",
          title: "Repo 1 chat",
          runtime: "codex",
          model: "test-model",
          reasoning_effort: "medium",
        })
        .execute();
      await db
        .insertInto("chat_sessions")
        .values({
          id: "chat-2",
          repo_id: "repo-2",
          title: "Repo 2 chat",
          runtime: "codex",
          model: "test-model",
          reasoning_effort: "medium",
        })
        .execute();
      await db
        .insertInto("chat_messages")
        .values({
          id: "chat-msg-1",
          session_id: "chat-1",
          role: "user",
          content: "hello chat",
        })
        .execute();
      await db
        .insertInto("chat_runs")
        .values({
          id: "chat-run-1",
          session_id: "chat-1",
          user_message_id: "chat-msg-1",
          assistant_message_id: "assistant-1",
          runtime: "codex",
          log_file_path: "/tmp/chat-run-1.log",
          status: "completed",
        })
        .execute();
      const chatWorkspace = await requireWorkspaceIdentity(aopPaths.repoDir("repo-1"));
      await db
        .insertInto("chat_run_checkpoints")
        .values({
          run_id: "chat-run-1",
          workspace_path: chatWorkspace.workspacePath,
          worktree_root: chatWorkspace.worktreeRoot,
          git_common_dir: chatWorkspace.gitCommonDirectory,
          branch: "main",
          head_oid: "head-1",
          before_ref: "refs/aop/chat-checkpoints/chat-1/chat-run-1/before",
          after_ref: "refs/aop/chat-checkpoints/chat-1/chat-run-1/after",
          before_oid: "before-1",
          after_oid: "after-1",
          before_status: "ready",
          after_status: "ready",
          before_error: null,
          after_error: null,
        })
        .execute();
      await db
        .insertInto("chat_run_changed_files")
        .values({
          run_id: "chat-run-1",
          path: "src/file.ts",
          old_path: null,
          status: "modified",
          additions: 1,
          deletions: 0,
          binary: false,
        })
        .execute();
      // Orphaned durable running row: purge must cancel it before deleting.
      await db
        .insertInto("chat_messages")
        .values({
          id: "chat-msg-running",
          session_id: "chat-1",
          role: "user",
          content: "still running",
        })
        .execute();
      await db
        .insertInto("chat_runs")
        .values({
          id: "chat-run-running",
          session_id: "chat-1",
          user_message_id: "chat-msg-running",
          assistant_message_id: "assistant-running",
          runtime: "codex",
          log_file_path: "/tmp/chat-run-running.log",
          status: "running",
        })
        .execute();
      mkdirSync(join(aopPaths.logs(), "chat-sessions", "chat-1"), { recursive: true });
      writeFileSync(join(aopPaths.logs(), "chat-sessions", "chat-1", "log.txt"), "chat");

      mkdirSync(aopPaths.repoDir("repo-1"), { recursive: true });
      mkdirSync(aopPaths.repoDir("repo-2"), { recursive: true });
      mkdirSync(aopPaths.worktrees("repo-1"), { recursive: true });
      writeFileSync(join(aopPaths.repoDir("repo-1"), "artifact.txt"), "repo 1");
      writeFileSync(join(aopPaths.repoDir("repo-2"), "artifact.txt"), "repo 2");

      const res = await app.request("/api/repos/repo-1", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, repoId: "repo-1", factoryReset: false });
      expect(await db.selectFrom("repos").selectAll().where("id", "=", "repo-1").execute()).toEqual(
        [],
      );
      expect(
        await db.selectFrom("chat_sessions").selectAll().where("id", "=", "chat-1").execute(),
      ).toEqual([]);
      expect(
        await db
          .selectFrom("chat_messages")
          .selectAll()
          .where("session_id", "=", "chat-1")
          .execute(),
      ).toEqual([]);
      expect(
        await db.selectFrom("chat_runs").selectAll().where("session_id", "=", "chat-1").execute(),
      ).toEqual([]);
      expect(
        await db
          .selectFrom("chat_run_checkpoints")
          .selectAll()
          .where("run_id", "=", "chat-run-1")
          .execute(),
      ).toEqual([]);
      expect(
        await db
          .selectFrom("chat_run_changed_files")
          .selectAll()
          .where("run_id", "=", "chat-run-1")
          .execute(),
      ).toEqual([]);
      // Purge only deletes the graph once the hidden refs are confirmed gone.
      const cleanupJobs = await db.selectFrom("chat_checkpoint_cleanup_jobs").selectAll().execute();
      expect(cleanupJobs).toHaveLength(1);
      expect(cleanupJobs[0]?.status).toBe("completed");
      expect(JSON.parse(cleanupJobs[0]?.refs_json ?? "[]")).toEqual([
        "refs/aop/chat-checkpoints/chat-1/chat-run-1/after",
        "refs/aop/chat-checkpoints/chat-1/chat-run-1/before",
      ]);
      expect(existsSync(join(aopPaths.logs(), "chat-sessions", "chat-1"))).toBe(false);
      expect(
        await db.selectFrom("chat_sessions").selectAll().where("id", "=", "chat-2").execute(),
      ).toHaveLength(1);
      expect(existsSync(aopPaths.repoDir("repo-1"))).toBe(false);
      expect(existsSync(aopPaths.worktrees("repo-1"))).toBe(false);

      // Repo 2 is untouched.
      expect(
        await db.selectFrom("repos").selectAll().where("id", "=", "repo-2").execute(),
      ).toHaveLength(1);
      expect(existsSync(join(aopPaths.repoDir("repo-2"), "artifact.txt"))).toBe(true);
    });

    test("factory-resets runtime data when removing the last repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo-1");
      await ctx.settingsRepository.set(SettingKey.CHAT_GLOBAL_INSTRUCTIONS, "17");
      mkdirSync(aopPaths.logs(), { recursive: true });
      writeFileSync(join(aopPaths.logs(), "local-server.log"), "log");

      const res = await app.request("/api/repos/repo-1", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, repoId: "repo-1", factoryReset: true });
      expect(await db.selectFrom("repos").selectAll().execute()).toEqual([]);
      expect(await ctx.settingsRepository.get(SettingKey.CHAT_GLOBAL_INSTRUCTIONS)).toBe(
        DEFAULT_SETTINGS[SettingKey.CHAT_GLOBAL_INSTRUCTIONS],
      );
      expect(existsSync(aopPaths.logs())).toBe(true);
    });

    test("stops reset when checkpoint refs cannot be durably identified", async () => {
      await ctx.settingsRepository.set(SettingKey.CHAT_GLOBAL_INSTRUCTIONS, "17");
      // A checkpoint with no run can only exist in a database edited or restored
      // outside the app, so the test has to step around the foreign key.
      await sql`PRAGMA foreign_keys = OFF`.execute(db);
      await db
        .insertInto("chat_run_checkpoints")
        .values({
          run_id: "orphaned-run",
          workspace_path: "/workspace/orphaned",
          worktree_root: "/workspace/orphaned",
          git_common_dir: "/repo/.git",
          branch: "main",
          head_oid: "head",
          before_ref: "refs/aop/chat-checkpoints/csess_orphan/orphaned-run/before",
          after_ref: "refs/aop/chat-checkpoints/csess_orphan/orphaned-run/after",
          before_oid: null,
          after_oid: null,
          before_status: "pending",
          after_status: "pending",
          before_error: null,
          after_error: null,
        })
        .execute();
      await sql`PRAGMA foreign_keys = ON`.execute(db);

      const result = await resetAllRuntimeData(ctx);

      expect(result).toMatchObject({ success: false, error: { reason: "preflight-failed" } });
      expect(await ctx.settingsRepository.get(SettingKey.CHAT_GLOBAL_INSTRUCTIONS)).toBe("17");
      expect(await db.selectFrom("chat_run_checkpoints").selectAll().execute()).toHaveLength(1);
      expect(await db.selectFrom("chat_checkpoint_cleanup_jobs").selectAll().execute()).toEqual([]);
    });
  });
});
