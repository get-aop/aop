import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus } from "../executor/execution-types.ts";
import { createRepoRoutes } from "../repo/routes.ts";

describe("task/routes", () => {
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

  describe("GET /api/repos/:repoId/tasks/:taskId/executions", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 404 when task belongs to different repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestRepo(db, "repo-2", "/path/to/repo2");
      await createTestTask(db, "task-1", "repo-2", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns empty array for task with no executions", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toEqual([]);
    });

    test("returns executions for task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.COMPLETED,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toHaveLength(1);
      expect(body.executions[0].id).toBe("exec-1");
      expect(body.executions[0].taskId).toBe("task-1");
      expect(body.executions[0].status).toBe("completed");
    });

    test("transforms aborted/cancelled status to failed", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "BLOCKED");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.ABORTED,
        started_at: "2024-01-01T00:00:00.000Z",
      });
      await ctx.executionRepository.createExecution({
        id: "exec-2",
        task_id: "task-1",
        status: ExecutionStatus.CANCELLED,
        started_at: "2024-01-01T00:01:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toHaveLength(2);
      expect(body.executions[0].status).toBe("failed");
      expect(body.executions[1].status).toBe("failed");
    });

    test("returns executions with empty steps array when no steps exist", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.COMPLETED,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toHaveLength(1);
      expect(body.executions[0].steps).toEqual([]);
    });

    test("returns executions with step data including stepType", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        step_type: "implement",
        status: "success",
        started_at: "2024-01-01T00:00:00.000Z",
        ended_at: "2024-01-01T00:05:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-2",
        execution_id: "exec-1",
        step_type: "review",
        status: "running",
        started_at: "2024-01-01T00:05:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toHaveLength(1);
      expect(body.executions[0].steps).toHaveLength(2);

      expect(body.executions[0].steps[0].id).toBe("step-1");
      expect(body.executions[0].steps[0].stepType).toBe("implement");
      expect(body.executions[0].steps[0].status).toBe("success");
      expect(body.executions[0].steps[0].startedAt).toBe("2024-01-01T00:00:00.000Z");
      expect(body.executions[0].steps[0].endedAt).toBe("2024-01-01T00:05:00.000Z");
      expect(body.executions[0].steps[0].finishedAt).toBe("2024-01-01T00:05:00.000Z");

      expect(body.executions[0].steps[1].id).toBe("step-2");
      expect(body.executions[0].steps[1].stepType).toBe("review");
      expect(body.executions[0].steps[1].status).toBe("running");
      expect(body.executions[0].steps[1].endedAt).toBeUndefined();
      expect(body.executions[0].steps[1].finishedAt).toBeUndefined();
    });

    test("returns steps ordered by startedAt ascending", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-2",
        execution_id: "exec-1",
        step_type: "review",
        status: "running",
        started_at: "2024-01-01T00:05:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        step_type: "implement",
        status: "success",
        started_at: "2024-01-01T00:00:00.000Z",
        ended_at: "2024-01-01T00:05:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions[0].steps[0].stepType).toBe("implement");
      expect(body.executions[0].steps[1].stepType).toBe("review");
    });

    test("returns step error when present", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "BLOCKED");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.FAILED,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        step_type: "implement",
        status: "failure",
        started_at: "2024-01-01T00:00:00.000Z",
        ended_at: "2024-01-01T00:05:00.000Z",
        error: "Build failed: syntax error",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions[0].steps[0].error).toBe("Build failed: syntax error");
    });

    test("returns workflow signal when present on a step", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "BLOCKED");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.FAILED,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        step_id: "quick-review",
        step_type: "review",
        status: "success",
        signal: "REVIEW_FAILED",
        started_at: "2024-01-01T00:00:00.000Z",
        ended_at: "2024-01-01T00:05:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions[0].steps[0].signal).toBe("REVIEW_FAILED");
    });
  });

  describe("POST /api/repos/:repoId/tasks/:taskId/ready", () => {
    const changePath = "changes/feat";

    const createPromptFile = (repoId: string) => {
      const dir = join(aopPaths.repoDir(repoId), changePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tasks.md"), "# Tasks\n- [ ] Task 1");
    };

    const createAssignedAgent = async (agentId: string) => {
      const workflowId = `workflow-${agentId}`;
      const now = new Date().toISOString();
      await db
        .insertInto("workflows")
        .values({ id: workflowId, name: workflowId, definition: "{}" })
        .execute();
      await db
        .insertInto("agents")
        .values({
          id: agentId,
          name: agentId,
          role: "developer",
          runtime_provider: "hermes",
          provider: "openai-codex",
          model: "gpt-5.4",
          workflow_id: workflowId,
          status: "active",
          artifact_path: `/tmp/.aop/agents/${agentId}`,
          source_kind: "manual",
          source_ref: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto("agent_repo_memberships")
        .values({
          agent_id: agentId,
          repo_id: "repo-1",
          membership_role: "primary",
          created_at: now,
        })
        .execute();
    };

    const assignTask = async (taskId: string, agentId: string) => {
      await createAssignedAgent(agentId);
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId,
        agentId,
        repoId: "repo-1",
        statusColumn: "DRAFT",
      });
    };

    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 404 when task belongs to different repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestRepo(db, "repo-2", "/path/to/repo2");
      await createTestTask(db, "task-1", "repo-2", changePath, "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("marks task ready when task.md already exists", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");
      await assignTask("task-1", "worker-ready");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.taskId).toBe("task-1");
    });

    test("marks DRAFT task as ready", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");
      createPromptFile("repo-1");
      await assignTask("task-1", "worker-draft");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.taskId).toBe("task-1");
    });

    test("marks BLOCKED task as ready", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "BLOCKED");
      createPromptFile("repo-1");
      await assignTask("task-1", "worker-blocked");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test("returns alreadyReady=true for READY task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "READY");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.alreadyReady).toBe(true);
    });

    test("returns 409 for WORKING task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Invalid task status");
      expect(body.status).toBe("WORKING");
    });

    test("returns 409 when task is unassigned", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");
      createPromptFile("repo-1");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Task must be assigned to a worker before marking ready");
    });

    test("preserves a valid explicit workflow while clearing branch and provider overrides", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");
      createPromptFile("repo-1");
      await assignTask("task-1", "worker-clear");
      await db
        .insertInto("workflows")
        .values({ id: "custom-workflow", name: "custom-workflow", definition: "{}" })
        .execute();
      await ctx.taskRepository.update("task-1", {
        preferred_workflow: "custom-workflow",
        base_branch: "release/v2",
        preferred_provider: "opencode:opencode-go/kimi-k2.7-code",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.preferred_workflow).toBe("custom-workflow");
      expect(task?.base_branch).toBeNull();
      expect(task?.preferred_provider).toBe("openai-codex");
    });

    test("returns 422 when the task execution model is not runnable by the local runtime", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestRepo(db, "shared-ui", "/path/to/shared-ui");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");
      createPromptFile("repo-1");
      await assignTask("task-1", "worker-v1");

      writeFileSync(
        join(aopPaths.repoDir("repo-1"), changePath, "task.md"),
        [
          "---",
          "id: task-1",
          "title: feat",
          "status: DRAFT",
          "changePath: changes/feat",
          "execution:",
          "  version: 1",
          "  coordinationMode: multi-repository",
          "  coordinationPhase: developers-assigned",
          "  architect:",
          "    agentId: architect-1",
          "    role: architect",
          "    repositories:",
          "      - repoId: repo-1",
          "        assignment: control-plane",
          "  developers:",
          "    - agentId: developer-1",
          "      role: developer",
          "      sliceId: slice-a",
          "      lifecycle: assigned",
          "      repositories:",
          "        - repoId: repo-1",
          "          assignment: primary",
          "    - agentId: developer-2",
          "      role: developer",
          "      sliceId: slice-b",
          "      lifecycle: assigned",
          "      repositories:",
          "        - repoId: shared-ui",
          "          assignment: primary",
          "  guardrails:",
          "    maxTotalAgents: 6",
          "    maxDeveloperAgents: 5",
          "    maxDeveloperAssignmentsPerTask: 1",
          "    requireSinglePrimaryRepository: true",
          "    allowSupportingRepositories: true",
          "    architectRunsInControlPlane: true",
          "---",
          "",
          "## Description",
          "Execution-aware task",
          "",
        ].join("\n"),
      );

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toBe("Task execution model is not runnable by the current local runtime");
      expect(body.message).toContain("exactly one developer assignment");
    });
  });

  describe("PUT /api/repos/:repoId/tasks/:taskId/assignment", () => {
    const createAgent = async (agentId: string, repoIds = ["repo-1"]): Promise<void> => {
      const now = new Date().toISOString();
      await db
        .insertInto("workflows")
        .values({ id: `workflow-${agentId}`, name: `workflow-${agentId}`, definition: "{}" })
        .execute();
      await db
        .insertInto("agents")
        .values({
          id: agentId,
          name: agentId,
          role: "developer",
          runtime_provider: "hermes",
          provider: "openai-codex",
          model: "gpt-5.4",
          workflow_id: `workflow-${agentId}`,
          status: "active",
          artifact_path: `/tmp/.aop/agents/${agentId}`,
          source_kind: "manual",
          source_ref: null,
          created_at: now,
          updated_at: now,
        })
        .execute();

      for (const repoId of repoIds) {
        await db
          .insertInto("agent_repo_memberships")
          .values({
            agent_id: agentId,
            repo_id: repoId,
            membership_role: "primary",
            created_at: now,
          })
          .execute();
      }
    };

    test("assigns a task to one active worker", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");
      await createAgent("agent-1");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/assignment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, taskId: "task-1", assignedAgentId: "agent-1" });

      const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId("task-1");
      expect(assignment?.agent_id).toBe("agent-1");
      expect(assignment?.repo_id).toBe("repo-1");
      expect(assignment?.status_column).toBe("DRAFT");
    });

    test("clears the current task assignment when agentId is null", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");
      await createAgent("agent-1");
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-1",
        agentId: "agent-1",
        repoId: "repo-1",
        statusColumn: "DRAFT",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/assignment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: null }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, taskId: "task-1", assignedAgentId: null });
      expect(await ctx.taskAssignmentRepository.getCurrentByTaskId("task-1")).toBeNull();
    });
  });

  describe("PATCH /api/repos/:repoId/tasks/:taskId/board-column", () => {
    const createAgent = async (agentId: string, repoIds = ["repo-1"]): Promise<void> => {
      const now = new Date().toISOString();
      await db
        .insertInto("workflows")
        .values({ id: `workflow-${agentId}`, name: `workflow-${agentId}`, definition: "{}" })
        .execute();
      await db
        .insertInto("agents")
        .values({
          id: agentId,
          name: agentId,
          role: "developer",
          runtime_provider: "pi",
          provider: "openai-codex",
          model: "gpt-5.4",
          workflow_id: `workflow-${agentId}`,
          status: "active",
          artifact_path: `/tmp/.aop/agents/${agentId}`,
          source_kind: "manual",
          source_ref: null,
          created_at: now,
          updated_at: now,
        })
        .execute();

      for (const repoId of repoIds) {
        await db
          .insertInto("agent_repo_memberships")
          .values({
            agent_id: agentId,
            repo_id: repoId,
            membership_role: "primary",
            created_at: now,
          })
          .execute();
      }
    };

    test("assigns an unassigned draft task to a worker in the draft column", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");
      await createAgent("agent-1");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/board-column", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: "DRAFT", agentId: "agent-1" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        ok: true,
        taskId: "task-1",
        boardColumn: "DRAFT",
        status: "DRAFT",
        assignedAgentId: "agent-1",
      });

      const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId("task-1");
      expect(assignment?.agent_id).toBe("agent-1");
      expect(assignment?.status_column).toBe("DRAFT");
    });

    test("promotes a draft task to ready when dropped in the ready column", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");
      await createAgent("agent-1");
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-1",
        agentId: "agent-1",
        repoId: "repo-1",
        statusColumn: "DRAFT",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/board-column", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: "READY", agentId: "agent-1" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        ok: true,
        taskId: "task-1",
        boardColumn: "READY",
        status: "READY",
        assignedAgentId: "agent-1",
      });

      const updatedTask = await ctx.taskRepository.get("task-1");
      expect(updatedTask?.status).toBe("READY");
      const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId("task-1");
      expect(assignment?.status_column).toBe("READY");
    });

    test("moves a ready task to in progress when dropped in the in progress column", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "READY");
      await createAgent("agent-1");
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-1",
        agentId: "agent-1",
        repoId: "repo-1",
        statusColumn: "READY",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/board-column", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: "IN_PROGRESS", agentId: "agent-1" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        ok: true,
        taskId: "task-1",
        boardColumn: "IN_PROGRESS",
        status: "READY",
        assignedAgentId: "agent-1",
      });

      const updatedTask = await ctx.taskRepository.get("task-1");
      expect(updatedTask?.status).toBe("READY");
      const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId("task-1");
      expect(assignment?.status_column).toBe("IN_PROGRESS");
    });

    test("restores the previous assignment when draft in-progress promotion cannot mark ready", async () => {
      const changePath = "changes/feat";
      await createTestRepo(db, "repo-1", aopPaths.repoDir("repo-1"));
      await createTestRepo(db, "shared-ui", "/path/to/shared-ui");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");
      await createAgent("agent-1", ["shared-ui"]);
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-1",
        agentId: "agent-1",
        repoId: "repo-1",
        statusColumn: "DRAFT",
      });
      const taskDir = join(aopPaths.repoDir("repo-1"), changePath);
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(
        join(taskDir, "task.md"),
        [
          "---",
          "id: task-1",
          "title: feat",
          "status: DRAFT",
          "changePath: changes/feat",
          "execution:",
          "  version: 1",
          "  coordinationMode: multi-repository",
          "  coordinationPhase: developers-assigned",
          "  architect:",
          "    agentId: architect-1",
          "    role: architect",
          "    repositories:",
          "      - repoId: repo-1",
          "        assignment: control-plane",
          "  developers:",
          "    - agentId: agent-1",
          "      role: developer",
          "      sliceId: slice-a",
          "      lifecycle: assigned",
          "      repositories:",
          "        - repoId: repo-1",
          "          assignment: primary",
          "  guardrails:",
          "    maxTotalAgents: 6",
          "    maxDeveloperAgents: 5",
          "    maxDeveloperAssignmentsPerTask: 1",
          "    requireSinglePrimaryRepository: true",
          "    allowSupportingRepositories: true",
          "    architectRunsInControlPlane: true",
          "---",
          "",
          "## Description",
          "Execution-aware task",
        ].join("\n"),
      );

      const res = await app.request("/api/repos/repo-1/tasks/task-1/board-column", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: "IN_PROGRESS", agentId: "agent-1" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toBe("Task execution model is not runnable by the current local runtime");

      const updatedTask = await ctx.taskRepository.get("task-1");
      expect(updatedTask?.status).toBe("DRAFT");
      const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId("task-1");
      expect(assignment?.agent_id).toBe("agent-1");
      expect(assignment?.status_column).toBe("DRAFT");
    });
  });

  describe("DELETE /api/repos/:repoId/tasks/:taskId", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("removes DRAFT task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.taskId).toBe("task-1");
      expect(body.aborted).toBe(false);
    });

    test("removes READY task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "READY");

      const res = await app.request("/api/repos/repo-1/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test("returns alreadyRemoved=true for REMOVED task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "REMOVED");

      const res = await app.request("/api/repos/repo-1/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.alreadyRemoved).toBe(true);
    });

    test("returns 409 for WORKING task without force", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Task is currently working, use force=true to abort");
    });
  });

  describe("POST /api/repos/:repoId/tasks/:taskId/block", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 404 when task belongs to different repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestRepo(db, "repo-2", "/path/to/repo2");
      await createTestTask(db, "task-1", "repo-2", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 409 for non-WORKING task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Task is not currently working");
      expect(body.status).toBe("DRAFT");
    });

    test("blocks WORKING task successfully", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.taskId).toBe("task-1");
      expect(body.agentKilled).toBeDefined();
    });
  });

  describe("GET /api/repos/:repoId/tasks/:taskId/pause-context", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1/pause-context");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent/pause-context");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 409 when task is not PAUSED", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/pause-context");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Task is not paused");
    });

    test("returns pause context and signal for PAUSED task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "PAUSED");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "success",
        signal: "REQUIRES_INPUT",
        pause_context: "INPUT_REASON: Need API key\nINPUT_TYPE: text",
        started_at: new Date().toISOString(),
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/pause-context");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.pauseContext).toBe("INPUT_REASON: Need API key\nINPUT_TYPE: text");
      expect(body.signal).toBe("REQUIRES_INPUT");
    });

    test("returns signal for review workflow", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "PAUSED");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "success",
        signal: "PLAN_READY",
        pause_context: "Implementation plan for feature X",
        started_at: new Date().toISOString(),
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/pause-context");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.signal).toBe("PLAN_READY");
      expect(body.pauseContext).toBe("Implementation plan for feature X");
    });

    test("returns null pauseContext and signal when no step exists", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "PAUSED");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/pause-context");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.pauseContext).toBeNull();
      expect(body.signal).toBeNull();
    });
  });

  describe("POST /api/repos/:repoId/tasks/:taskId/resume", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "test" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "test" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 400 when input is missing", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "PAUSED");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required field: input");
    });

    test("returns 409 when task is not PAUSED via handler", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "test" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Task is not paused");
    });

    test("returns 404 when no step execution exists", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "PAUSED");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "test" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("No step execution found");
    });

    test("enqueues resume even when no server sync configured", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "PAUSED");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "success",
        signal: "REQUIRES_INPUT",
        started_at: new Date().toISOString(),
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "test" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.taskId).toBe("task-1");
    });
  });

  describe("POST /api/repos/:repoId/tasks/bulk/:action", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/bulk/git-pull", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 400 for an unknown or removed PR action", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      for (const action of ["frobnicate", "merge", "create-pr", "fix-ci"]) {
        const res = await app.request(`/api/repos/repo-1/tasks/bulk/${action}`, {
          method: "POST",
        });
        const body: AnyJson = await res.json();

        expect(res.status).toBe(400);
        expect(body.error).toContain("action");
      }
    });
  });
});

describe("task/routes - resolve endpoint", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: ReturnType<typeof createApp>;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = createApp({ ctx, startTimeMs: Date.now() });
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  describe("GET /api/tasks/resolve/:identifier", () => {
    test("returns 404 for non-existent task by id", async () => {
      const res = await app.request("/api/tasks/resolve/non-existent");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("resolves task by id", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const res = await app.request("/api/tasks/resolve/task-1");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.task).toBeDefined();
      expect(body.task.id).toBe("task-1");
      expect(body.task.repo_id).toBe("repo-1");
      expect(body.task.change_path).toBe("docs/tasks/feat");
    });
  });
});
