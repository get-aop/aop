import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
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

    test("purges repo-owned rows and files without touching other repos", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo-1");
      await createTestRepo(db, "repo-2", "/path/to/repo-2");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DONE");
      await createTestTask(db, "task-2", "repo-2", "changes/feat-2", "DONE");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "completed",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "success",
        started_at: new Date().toISOString(),
      });
      await db
        .insertInto("runtime_events")
        .values({
          id: "event-1",
          task_id: "task-1",
          execution_id: "exec-1",
          step_execution_id: "step-1",
          kind: "tool_started",
          source_kind: "test",
          source_id: "step-1",
          occurred_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto("channels")
        .values({
          id: "channel-1",
          repo_id: "repo-1",
          owner_agent_id: null,
          kind: "group",
          name: "repo-1 group",
          artifact_path: "/tmp/channel-1",
        })
        .execute();
      await db
        .insertInto("channel_messages")
        .values({
          id: "message-1",
          channel_id: "channel-1",
          author_type: "user",
          author_agent_id: null,
          content: "hello",
        })
        .execute();

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
      await db
        .insertInto("scheduler_triggers")
        .values({
          id: "sched-1",
          repo_id: "repo-1",
          name: "reimport",
          action: "re_import_tracker",
          cadence_secs: 60,
          enabled: true,
          max_items_per_run: 10,
          require_approval_before_handoff: false,
        })
        .execute();
      await db
        .insertInto("signals")
        .values({
          id: "sig-1",
          repo_id: "repo-1",
          source_task_id: "task-1",
          source_execution_id: null,
          kind: "follow-up",
          title: "Follow up",
          body: "body",
          provenance: "aop",
          confidence: "medium",
          consumed_at: null,
          consumed_task_id: null,
        })
        .execute();
      await db
        .insertInto("scheduler_triggers")
        .values({
          id: "sched-2",
          repo_id: "repo-2",
          name: "keep",
          action: "re_import_tracker",
          cadence_secs: 60,
          enabled: true,
          max_items_per_run: 10,
          require_approval_before_handoff: false,
        })
        .execute();
      await db
        .insertInto("signals")
        .values({
          id: "sig-2",
          repo_id: "repo-2",
          source_task_id: "task-2",
          source_execution_id: null,
          kind: "docs-gap",
          title: "Keep",
          body: "body",
          provenance: "aop",
          confidence: "low",
          consumed_at: null,
          consumed_task_id: null,
        })
        .execute();
      mkdirSync(join(aopPaths.logs(), "chat-sessions", "chat-1"), { recursive: true });
      mkdirSync(join(aopPaths.logs(), "chat-sessions", "chat-1-delegate"), { recursive: true });
      mkdirSync(join(aopPaths.logs(), "chat-sessions", "chat-1-control"), { recursive: true });
      writeFileSync(join(aopPaths.logs(), "chat-sessions", "chat-1", "log.txt"), "chat");
      writeFileSync(join(aopPaths.logs(), "chat-sessions", "chat-1-delegate", "log.txt"), "del");
      writeFileSync(join(aopPaths.logs(), "chat-sessions", "chat-1-control", "log.txt"), "ctl");

      const insertAgent = (id: string) =>
        db
          .insertInto("agents")
          .values({
            id,
            name: id,
            role: "developer",
            runtime_provider: "pi",
            provider: "pi",
            model: "test-model",
            workflow_id: "aop-default-gpt",
            status: "active",
            artifact_path: aopPaths.agent(id),
            source_kind: "manual",
          })
          .execute();
      await insertAgent("agent-exclusive");
      await insertAgent("agent-shared");
      await db
        .insertInto("agent_repo_memberships")
        .values([
          { agent_id: "agent-exclusive", repo_id: "repo-1", membership_role: "primary" },
          { agent_id: "agent-shared", repo_id: "repo-1", membership_role: "primary" },
          { agent_id: "agent-shared", repo_id: "repo-2", membership_role: "primary" },
        ])
        .execute();
      mkdirSync(aopPaths.agent("agent-exclusive"), { recursive: true });
      mkdirSync(aopPaths.agent("agent-shared"), { recursive: true });

      mkdirSync(aopPaths.repoDir("repo-1"), { recursive: true });
      mkdirSync(aopPaths.repoDir("repo-2"), { recursive: true });
      mkdirSync(aopPaths.worktrees("repo-1"), { recursive: true });
      writeFileSync(join(aopPaths.repoDir("repo-1"), "artifact.txt"), "repo 1");
      writeFileSync(join(aopPaths.repoDir("repo-2"), "artifact.txt"), "repo 2");

      const res = await app.request("/api/repos/repo-1?force=true", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, repoId: "repo-1", factoryReset: false });
      expect(await db.selectFrom("repos").selectAll().where("id", "=", "repo-1").execute()).toEqual(
        [],
      );
      expect(
        await db.selectFrom("tasks").selectAll().where("repo_id", "=", "repo-1").execute(),
      ).toEqual([]);
      expect(
        await db.selectFrom("executions").selectAll().where("task_id", "=", "task-1").execute(),
      ).toEqual([]);
      expect(
        await db.selectFrom("runtime_events").selectAll().where("task_id", "=", "task-1").execute(),
      ).toEqual([]);
      expect(
        await db.selectFrom("channels").selectAll().where("repo_id", "=", "repo-1").execute(),
      ).toEqual([]);
      expect(
        await db
          .selectFrom("channel_messages")
          .selectAll()
          .where("channel_id", "=", "channel-1")
          .execute(),
      ).toEqual([]);
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
      expect(
        await db
          .selectFrom("scheduler_triggers")
          .selectAll()
          .where("repo_id", "=", "repo-1")
          .execute(),
      ).toEqual([]);
      expect(
        await db.selectFrom("signals").selectAll().where("repo_id", "=", "repo-1").execute(),
      ).toEqual([]);
      expect(
        await db
          .selectFrom("scheduler_triggers")
          .selectAll()
          .where("repo_id", "=", "repo-2")
          .execute(),
      ).toHaveLength(1);
      expect(
        await db.selectFrom("signals").selectAll().where("repo_id", "=", "repo-2").execute(),
      ).toHaveLength(1);
      expect(existsSync(join(aopPaths.logs(), "chat-sessions", "chat-1"))).toBe(false);
      expect(existsSync(join(aopPaths.logs(), "chat-sessions", "chat-1-delegate"))).toBe(false);
      expect(existsSync(join(aopPaths.logs(), "chat-sessions", "chat-1-control"))).toBe(false);
      expect(
        await db.selectFrom("chat_sessions").selectAll().where("id", "=", "chat-2").execute(),
      ).toHaveLength(1);
      expect(existsSync(aopPaths.repoDir("repo-1"))).toBe(false);
      expect(existsSync(aopPaths.worktrees("repo-1"))).toBe(false);

      // A worker whose only repo was purged is archived and scrubbed.
      const exclusiveAgent = await ctx.agentRepository.getById("agent-exclusive");
      expect(exclusiveAgent?.status).toBe("archived");
      expect(existsSync(aopPaths.agent("agent-exclusive"))).toBe(false);

      // Repo 2 and its shared worker are untouched.
      const sharedAgent = await ctx.agentRepository.getById("agent-shared");
      expect(sharedAgent?.status).toBe("active");
      expect(existsSync(aopPaths.agent("agent-shared"))).toBe(true);
      expect(await ctx.agentRepository.listRepoMemberships("agent-shared")).toHaveLength(1);
      expect(
        await db.selectFrom("repos").selectAll().where("id", "=", "repo-2").execute(),
      ).toHaveLength(1);
      expect(existsSync(join(aopPaths.repoDir("repo-2"), "artifact.txt"))).toBe(true);
    });

    test("factory-resets runtime data when removing the last repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo-1");
      await ctx.settingsRepository.set(SettingKey.MAX_CONCURRENT_TASKS, "17");
      await db
        .insertInto("agents")
        .values({
          id: "agent-1",
          name: "Demo Agent",
          role: "developer",
          runtime_provider: "pi",
          provider: "pi",
          model: "test-model",
          workflow_id: "aop-default-gpt",
          status: "active",
          artifact_path: aopPaths.agent("agent-1"),
          source_kind: "manual",
        })
        .execute();
      await db
        .insertInto("scheduler_triggers")
        .values({
          id: "sched-last",
          repo_id: "repo-1",
          name: "reimport",
          action: "re_import_tracker",
          cadence_secs: 60,
          enabled: true,
          max_items_per_run: 10,
          require_approval_before_handoff: false,
        })
        .execute();
      await db
        .insertInto("signals")
        .values({
          id: "sig-last",
          repo_id: "repo-1",
          source_task_id: null,
          source_execution_id: null,
          kind: "follow-up",
          title: "Last signal",
          body: "body",
          provenance: "aop",
          confidence: "high",
          consumed_at: null,
          consumed_task_id: null,
        })
        .execute();
      mkdirSync(aopPaths.agents(), { recursive: true });
      mkdirSync(aopPaths.logs(), { recursive: true });
      writeFileSync(join(aopPaths.agents(), "artifact.txt"), "agent");
      writeFileSync(join(aopPaths.logs(), "local-server.log"), "log");

      const res = await app.request("/api/repos/repo-1?force=true", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, repoId: "repo-1", factoryReset: true });
      expect(await db.selectFrom("repos").selectAll().execute()).toEqual([]);
      expect(await db.selectFrom("agents").selectAll().execute()).toEqual([]);
      expect(await db.selectFrom("scheduler_triggers").selectAll().execute()).toEqual([]);
      expect(await db.selectFrom("signals").selectAll().execute()).toEqual([]);
      expect(await ctx.settingsRepository.get(SettingKey.MAX_CONCURRENT_TASKS)).toBe(
        DEFAULT_SETTINGS[SettingKey.MAX_CONCURRENT_TASKS],
      );
      expect(await ctx.workflowService.listWorkflows()).not.toContain("aop-default-gpt");
      expect(existsSync(join(aopPaths.agents(), "artifact.txt"))).toBe(false);
      expect(existsSync(aopPaths.logs())).toBe(true);
    });

    test("stops reset when checkpoint refs cannot be durably identified", async () => {
      await ctx.settingsRepository.set(SettingKey.MAX_CONCURRENT_TASKS, "17");
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

      const result = await resetAllRuntimeData(ctx);

      expect(result).toMatchObject({ success: false, error: { reason: "preflight-failed" } });
      expect(await ctx.settingsRepository.get(SettingKey.MAX_CONCURRENT_TASKS)).toBe("17");
      expect(await db.selectFrom("chat_run_checkpoints").selectAll().execute()).toHaveLength(1);
      expect(await db.selectFrom("chat_checkpoint_cleanup_jobs").selectAll().execute()).toEqual([]);
    });

    test("returns 409 when repo has working tasks without force", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Cannot remove repo with working tasks");
      expect(body.count).toBe(1);
    });
  });

  describe("GET /api/repos/:id/tasks", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns tasks for repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const res = await app.request("/api/repos/repo-1/tasks");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.tasks).toHaveLength(2);
    });

    test("excludes REMOVED tasks", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "REMOVED");

      const res = await app.request("/api/repos/repo-1/tasks");
      const body: AnyJson = await res.json();

      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].id).toBe("task-1");
    });
  });
});
