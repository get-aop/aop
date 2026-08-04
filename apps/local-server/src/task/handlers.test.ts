import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import {
  archiveTask,
  blockTask,
  getTaskById,
  markTaskReady,
  moveTaskToBoardColumn,
  removeTask,
  resolveTaskByIdentifier,
  resumeTask,
  unarchiveTask,
} from "./handlers.ts";

const TEST_REPO_ID = "repo-1";

describe("task/handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  describe("getTaskById", () => {
    test("returns task when found", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const task = await getTaskById(ctx, "task-1");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns null when task not found", async () => {
      const task = await getTaskById(ctx, "non-existent");

      expect(task).toBeNull();
    });
  });

  describe("resolveTaskByIdentifier", () => {
    test("resolves task by id", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const task = await resolveTaskByIdentifier(ctx, "task-1");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns null when task not found", async () => {
      const task = await resolveTaskByIdentifier(ctx, "non-existent");

      expect(task).toBeNull();
    });
  });

  describe("markTaskReady", () => {
    const changePath = "changes/feat";

    const readRepoPath = async (): Promise<string> => {
      const repo = await ctx.repoRepository.getById(TEST_REPO_ID);
      if (!repo) {
        throw new Error(`Missing test repo '${TEST_REPO_ID}'`);
      }

      return repo.path;
    };

    const createPromptFile = async () => {
      const dir = join(await readRepoPath(), changePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tasks.md"), "# Tasks\n- [ ] Task 1");
    };

    const createAssignedAgent = async (
      agentId: string,
      options: { status?: "active" | "archived"; repoId?: string } = {},
    ) => {
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
          status: options.status ?? "active",
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
          repo_id: options.repoId ?? TEST_REPO_ID,
          membership_role: "primary",
          created_at: now,
        })
        .execute();
    };

    const assignTask = async (
      taskId: string,
      agentId: string,
      statusColumn: "DRAFT" | "IN_PROGRESS" = "DRAFT",
    ) => {
      await createAssignedAgent(agentId);
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId,
        agentId,
        repoId: TEST_REPO_ID,
        statusColumn,
      });
    };

    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await markTaskReady(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { identifier: string }).identifier).toBe("non-existent");
      }
    });

    test("marks task as ready when task.md exists", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await assignTask("task-1", "worker-ready");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe("READY");
      }
    });

    test("marks DRAFT task as ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await assignTask("task-1", "worker-draft");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe("READY");
        expect(result.task.ready_at).not.toBeNull();
      }
    });

    test("checks generated task spec review criterion when marking ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      const taskFilePath = join(await readRepoPath(), changePath, "task.md");
      writeFileSync(
        taskFilePath,
        [
          "---",
          "id: task-1",
          "title: Generated task",
          "status: DRAFT",
          `created: ${new Date().toISOString()}`,
          "changePath: docs/tasks/feat",
          "---",
          "",
          "## Description",
          "Generated task",
          "",
          "## Requirements",
          "",
          "## Acceptance Criteria",
          "- [ ] Review issues.md and prd.md, then mark ready when implementation can start",
          "- [ ] Ship the actual feature",
          "",
        ].join("\n"),
      );
      await assignTask("task-1", "worker-task");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      const taskMarkdown = await Bun.file(taskFilePath).text();
      expect(taskMarkdown).toContain(
        "- [x] Review issues.md and prd.md, then mark ready when implementation can start",
      );
      expect(taskMarkdown).toContain("- [ ] Ship the actual feature");
    });

    test("preserves in progress assignment column when marking task ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await assignTask("task-1", "worker-in-progress", "IN_PROGRESS");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId("task-1");
      expect(assignment?.status_column).toBe("IN_PROGRESS");
    });

    test("moves draft tasks with plans directly to in progress", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await assignTask("task-1", "worker-direct");

      const result = await moveTaskToBoardColumn(
        ctx,
        TEST_REPO_ID,
        "task-1",
        "IN_PROGRESS",
        "worker-direct",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.status).toBe("READY");
        expect(result.boardColumn).toBe("IN_PROGRESS");
      }
      const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId("task-1");
      expect(assignment?.status_column).toBe("IN_PROGRESS");
    });

    test("marks BLOCKED task as ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "BLOCKED");
      await createPromptFile();
      await assignTask("task-1", "worker-blocked");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe("READY");
      }
    });

    test("returns ALREADY_READY when task is already ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "READY");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("ALREADY_READY");
        expect((result.error as { taskId: string }).taskId).toBe("task-1");
      }
    });

    test("returns INVALID_STATUS for WORKING task", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "WORKING");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("WORKING");
      }
    });

    test("returns INVALID_STATUS for DONE task", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DONE");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("DONE");
      }
    });

    test("returns NOT_ASSIGNED when task has no worker assignment", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_ASSIGNED");
        expect((result.error as { taskId: string }).taskId).toBe("task-1");
      }
    });

    test("preserves a valid explicit workflow while clearing branch and provider overrides", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await assignTask("task-1", "worker-clear");
      await db
        .insertInto("workflows")
        .values({ id: "custom-flow", name: "custom-flow", definition: "{}" })
        .execute();
      await ctx.taskRepository.update("task-1", {
        preferred_workflow: "custom-flow",
        base_branch: "feature/foo",
        preferred_provider: "opencode:opencode-go/kimi-k2.7-code",
      });

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.preferred_workflow).toBe("custom-flow");
        expect(result.task.base_branch).toBeNull();
        expect(result.task.preferred_provider).toBe("openai-codex");
      }
    });

    test("does not pin preferred_provider when assigned worker uses workflow-defined step agents", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-wf-defined", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      const workflowId = "workflow-zed";
      const now = new Date().toISOString();
      await db
        .insertInto("workflows")
        .values({ id: workflowId, name: "aop-default-gpt", definition: "{}" })
        .execute();
      await db
        .insertInto("agents")
        .values({
          id: "worker-zed",
          name: "Zed",
          role: "developer",
          runtime_provider: "opencode",
          provider: "opencode",
          model: "workflow-defined",
          workflow_id: workflowId,
          status: "active",
          artifact_path: "/tmp/.aop/agents/worker-zed",
          source_kind: "opencode-worker-profile",
          source_ref: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto("agent_repo_memberships")
        .values({
          agent_id: "worker-zed",
          repo_id: TEST_REPO_ID,
          membership_role: "primary",
          created_at: now,
        })
        .execute();
      await ctx.taskRepository.update("task-wf-defined", {
        preferred_provider: "opencode",
      });
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-wf-defined",
        agentId: "worker-zed",
        repoId: TEST_REPO_ID,
        statusColumn: "DRAFT",
      });

      const result = await markTaskReady(ctx, "task-wf-defined");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.preferred_provider).toBeNull();
      }
    });

    test("rejects a stale explicit workflow when marking ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-clear", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await createAssignedAgent("developer-clear");
      await ctx.taskRepository.update("task-clear", {
        preferred_workflow: "stale-flow",
      });
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-clear",
        agentId: "developer-clear",
        repoId: TEST_REPO_ID,
        statusColumn: "DRAFT",
      });

      const result = await markTaskReady(ctx, "task-clear");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toEqual({ code: "WORKFLOW_NOT_FOUND", workflow: "stale-flow" });
      }
    });

    test("persists task assignment and runtime overrides from the execution model's developer agent", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await assignTask("task-1", "developer-1");

      const taskDir = join(await readRepoPath(), changePath);
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
          "    - agentId: developer-1",
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

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.preferred_workflow).toBeNull();
        expect(result.task.preferred_provider).toBe("openai-codex");
      }

      const assignment = await db
        .selectFrom("task_assignments")
        .select(["agent_id", "repo_id", "is_current"])
        .where("task_id", "=", "task-1")
        .executeTakeFirst();

      expect(assignment?.agent_id).toBe("developer-1");
      expect(assignment?.repo_id).toBe(TEST_REPO_ID);
      expect(Boolean(assignment?.is_current)).toBe(true);
    });

    test("preserves in-progress assignment when syncing from execution context", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-in-progress", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await assignTask("task-in-progress", "developer-1", "IN_PROGRESS");

      const taskDir = join(await readRepoPath(), changePath);
      writeFileSync(
        join(taskDir, "task.md"),
        [
          "---",
          "id: task-in-progress",
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

      const result = await markTaskReady(ctx, "task-in-progress");

      expect(result.success).toBe(true);
      const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId("task-in-progress");
      expect(assignment?.status_column).toBe("IN_PROGRESS");
    });

    test("returns INVALID_EXECUTION_MODEL when the assigned agent is not a member of the task repository", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestRepo(db, "shared-ui", "/test/shared-ui");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await createAssignedAgent("developer-2", { repoId: "shared-ui" });
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-1",
        agentId: "developer-2",
        repoId: TEST_REPO_ID,
        statusColumn: "DRAFT",
      });

      const taskDir = join(await readRepoPath(), changePath);
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
          "    - agentId: developer-2",
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

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_EXECUTION_MODEL");
        expect((result.error as { message: string }).message).toContain(
          "not a member of repository",
        );
      }
    });

    test("returns INVALID_EXECUTION_MODEL when the assigned agent cannot read a supporting repository", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestRepo(db, "shared-ui", "/test/shared-ui");
      await createTestTask(db, "task-support", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await createAssignedAgent("developer-4");
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-support",
        agentId: "developer-4",
        repoId: TEST_REPO_ID,
        statusColumn: "DRAFT",
      });

      const taskDir = join(await readRepoPath(), changePath);
      writeFileSync(
        join(taskDir, "task.md"),
        [
          "---",
          "id: task-support",
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
          "    - agentId: developer-4",
          "      role: developer",
          "      sliceId: slice-a",
          "      lifecycle: assigned",
          "      repositories:",
          "        - repoId: repo-1",
          "          assignment: primary",
          "        - repoId: shared-ui",
          "          assignment: supporting",
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

      const result = await markTaskReady(ctx, "task-support");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_EXECUTION_MODEL");
        expect((result.error as { message: string }).message).toContain("supporting repository");
      }
    });

    test("does not generate plan.md or numbered subtasks before marking ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await assignTask("task-1", "worker-plan");

      const dir = join(await readRepoPath(), changePath);
      expect(await Bun.file(join(dir, "plan.md")).exists()).toBe(false);

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      expect(await Bun.file(join(dir, "plan.md")).exists()).toBe(false);
      expect(await Bun.file(join(dir, "001-task-1.md")).exists()).toBe(false);
    });

    test("returns UPDATE_FAILED when repository update fails", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await assignTask("task-1", "worker-update");

      const originalUpdate = ctx.taskRepository.update;
      ctx.taskRepository.update = mock(() => Promise.resolve(null));

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("UPDATE_FAILED");
      }

      ctx.taskRepository.update = originalUpdate;
    });

    test("returns INVALID_EXECUTION_MODEL when the task execution plan exceeds the v1 runtime contract", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestRepo(db, "shared-ui", "/test/shared-ui");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      await createPromptFile();
      await assignTask("task-1", "worker-v1");

      const taskDir = join(await readRepoPath(), changePath);
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
          "## Requirements",
          "- Validate execution metadata",
          "",
          "## Acceptance Criteria",
          "- [ ] Refuse unsupported multi-developer execution",
          "",
        ].join("\n"),
      );

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_EXECUTION_MODEL");
        expect((result.error as { message: string }).message).toContain(
          "exactly one developer assignment",
        );
      }
    });
  });
  describe("markTaskReady with retryFromStep", () => {
    const changePath = "changes/feat-retry";

    const createPromptFile = () => {
      const dir = join(aopPaths.repoDir(TEST_REPO_ID), changePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tasks.md"), "# Tasks");
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
          repo_id: TEST_REPO_ID,
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
        repoId: TEST_REPO_ID,
        statusColumn: "DRAFT",
      });
    };

    test("stores retryFromStep on the task", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "BLOCKED");
      createPromptFile();
      await assignTask("task-1", "worker-retry");

      const result = await markTaskReady(ctx, "task-1", { retryFromStep: "full-review" });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.retry_from_step).toBe("full-review");
      }
    });

    test("defaults blocked task retry to latest workflow step", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "BLOCKED");
      createPromptFile();
      await assignTask("task-1", "worker-retry-latest");
      const now = new Date().toISOString();
      await ctx.executionRepository.createExecution({
        id: "exec-retry",
        task_id: "task-1",
        status: "failed",
        started_at: now,
        completed_at: now,
        visited_steps: JSON.stringify(["implement"]),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-retry",
        execution_id: "exec-retry",
        step_id: "implement",
        step_type: "implement",
        agent_pid: null,
        session_id: null,
        status: "success",
        exit_code: 0,
        signal: null,
        pause_context: null,
        error: null,
        attempt: 1,
        iteration: 0,
        signals_json: null,
        started_at: now,
        ended_at: now,
      });

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.retry_from_step).toBe("implement");
      }
    });

    test("clears retryFromStep when not provided", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "BLOCKED");
      createPromptFile();
      await assignTask("task-1", "worker-retry-clear");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.retry_from_step).toBeNull();
      }
    });
  });

  describe("resumeTask", () => {
    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await resumeTask(ctx, "non-existent", "some input");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    test("returns NOT_PAUSED when task is not in PAUSED status", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, "changes/feat", "WORKING");

      const result = await resumeTask(ctx, "task-1", "some input");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_PAUSED");
      }
    });

    test("enqueues task with RESUMING status and stores resume_input", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, "changes/feat", "PAUSED");

      // Create execution + step so getLatestStepExecution works
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        step_type: "iterate",
        status: "running",
        started_at: new Date().toISOString(),
      });

      const result = await resumeTask(ctx, "task-1", "Approved, proceed");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.taskId).toBe("task-1");
      }

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("RESUMING");
      expect(task?.resume_input).toBe("Approved, proceed");
    });

    test("returns NO_STEP_EXECUTION when no step execution exists", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, "changes/feat", "PAUSED");

      const result = await resumeTask(ctx, "task-1", "some input");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NO_STEP_EXECUTION");
      }
    });
  });

  describe("removeTask", () => {
    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await removeTask(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { identifier: string }).identifier).toBe("non-existent");
      }
    });

    test("removes DRAFT task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.taskId).toBe("task-1");
        expect(result.aborted).toBe(false);
      }
    });

    test("removes READY task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "READY");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(true);
    });

    test("returns ALREADY_REMOVED when task is already removed", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "REMOVED");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("ALREADY_REMOVED");
        expect((result.error as { taskId: string }).taskId).toBe("task-1");
      }
    });

    test("returns TASK_WORKING when task is working without force", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TASK_WORKING");
        expect((result.error as { taskId: string }).taskId).toBe("task-1");
      }
    });

    test("aborts and returns success when task is working with force", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const result = await removeTask(ctx, "task-1", { force: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.taskId).toBe("task-1");
        expect(result.aborted).toBe(true);
      }
    });

    test("returns REMOVE_FAILED when repository markRemoved fails", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const originalMarkRemoved = ctx.taskRepository.markRemoved;
      ctx.taskRepository.markRemoved = mock(() => Promise.resolve(false));

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("REMOVE_FAILED");
      }

      ctx.taskRepository.markRemoved = originalMarkRemoved;
    });
  });

  describe("archiveTask", () => {
    test("archives a DONE task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const result = await archiveTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.taskId).toBe("task-1");
        expect(result.archivedAt).toBeString();
      }
      expect((await getTaskById(ctx, "task-1"))?.archived_at).toBeString();
    });

    test("rejects non-DONE tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const result = await archiveTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        if (result.error.code === "INVALID_STATUS") {
          expect(result.error.status).toBe("DRAFT");
        }
      }
    });

    test("does not update an already archived task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");
      const first = await archiveTask(ctx, "task-1");
      const updatedAt = (await getTaskById(ctx, "task-1"))?.updated_at;

      const second = await archiveTask(ctx, "task-1");

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      if (second.success) expect(second.alreadyArchived).toBe(true);
      expect((await getTaskById(ctx, "task-1"))?.updated_at).toBe(updatedAt);
    });
  });

  describe("unarchiveTask", () => {
    test("restores an archived DONE task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");
      await archiveTask(ctx, "task-1");

      const result = await unarchiveTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) expect(result.archivedAt).toBeNull();
      expect((await getTaskById(ctx, "task-1"))?.archived_at).toBeNull();
    });

    test("is idempotent for non-archived DONE tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const result = await unarchiveTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) expect(result.alreadyUnarchived).toBe(true);
    });
  });

  describe("blockTask", () => {
    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await blockTask(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { identifier: string }).identifier).toBe("non-existent");
      }
    });

    test("blocks WORKING task and sets status to BLOCKED", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const result = await blockTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.taskId).toBe("task-1");
        expect(result.agentKilled).toBe(false);
      }

      const task = await getTaskById(ctx, "task-1");
      expect(task?.status).toBe("BLOCKED");
    });

    test("returns INVALID_STATUS for DRAFT task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const result = await blockTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("DRAFT");
      }
    });

    test("returns INVALID_STATUS for DONE task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const result = await blockTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("DONE");
      }
    });

    test("returns INVALID_STATUS for BLOCKED task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "BLOCKED");

      const result = await blockTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("BLOCKED");
      }
    });
  });
});
