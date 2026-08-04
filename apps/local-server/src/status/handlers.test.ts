import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DASHBOARD_SWIMLANES } from "@aop/common";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { serializeFrontmatter } from "../task-docs/frontmatter.ts";
import { getServerStatus } from "./handlers.ts";

describe("status/handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;

  beforeEach(async () => {
    db = await createTestDb();
    repoPath = await mkdtemp(join(tmpdir(), "aop-status-handlers-"));
    await createTestRepo(db, "repo-1", repoPath, { maxConcurrentTasks: 3 });
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("returns server-authored swimlane metadata from the task execution model", async () => {
    const changePath = "docs/tasks/get-57-developer-slice";
    await createTestTask(db, "task-1", "repo-1", changePath, "WORKING");

    await Bun.write(
      join(repoPath, changePath, "task.md"),
      serializeFrontmatter({
        frontmatter: {
          id: "task-1",
          title: "GET-57 developer slice",
          status: "WORKING",
          created: "2026-03-31T00:00:00.000Z",
          changePath,
          execution: {
            version: 1,
            coordinationMode: "single-repository",
            coordinationPhase: "developers-verifying",
            architect: {
              agentId: "architect-1",
              role: "architect",
              repositories: [{ repoId: "repo-1", assignment: "control-plane" }],
            },
            developers: [
              {
                agentId: "developer-2",
                role: "developer",
                sliceId: "slice-ui",
                lifecycle: "verifying",
                repositories: [{ repoId: "repo-1", assignment: "primary" }],
              },
            ],
          },
        },
        content: [
          "",
          "## Description",
          "Redesign the dashboard around swimlanes.",
          "",
          "## Requirements",
          "",
          "## Acceptance Criteria",
          "- [ ] Show developer verification state in the dashboard.",
          "",
        ].join("\n"),
      }),
    );

    const status = await getServerStatus(ctx);

    expect(status.swimlanes).toEqual(DEFAULT_DASHBOARD_SWIMLANES);

    expect(status.repos[0]?.tasks[0]?.swimlane).toEqual({
      laneId: "developer-execution",
      phaseLabel: "Verifying",
      ownerLabel: "developer-2",
      ownerRole: "developer",
    });
  });

  test("falls back to architect control metadata for legacy draft tasks without an execution model", async () => {
    await createTestTask(db, "task-2", "repo-1", "docs/tasks/get-57-legacy", "DRAFT");

    const status = await getServerStatus(ctx);
    const legacyTask = status.repos[0]?.tasks.find((task) => task.id === "task-2");

    expect(legacyTask?.swimlane).toEqual({
      laneId: "architect-control",
      phaseLabel: "Planning",
      ownerLabel: "Architect",
      ownerRole: "architect",
    });
  });

  test("projects the current task assignment for dashboard worker rows", async () => {
    await createTestTask(db, "task-assigned", "repo-1", "docs/tasks/assigned", "READY");
    const now = new Date().toISOString();
    await db
      .insertInto("workflows")
      .values({ id: "worker-flow", name: "worker-flow", definition: "{}" })
      .execute();
    await db
      .insertInto("agents")
      .values({
        id: "agent-1",
        name: "Worker One",
        role: "developer",
        runtime_provider: "hermes",
        provider: "openai-codex",
        model: "gpt-5.4",
        workflow_id: "worker-flow",
        status: "active",
        artifact_path: "/tmp/.aop/agents/agent-1",
        source_kind: "manual",
        source_ref: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await ctx.taskAssignmentRepository.upsertCurrent({
      taskId: "task-assigned",
      agentId: "agent-1",
      repoId: "repo-1",
      statusColumn: "READY",
    });

    const status = await getServerStatus(ctx);
    const assignedTask = status.repos[0]?.tasks.find((task) => task.id === "task-assigned");

    expect(assignedTask?.assignedAgentId).toBe("agent-1");
    expect(assignedTask?.assignedAgentName).toBe("Worker One");
    expect(assignedTask?.assignedAgentRole).toBe("developer");
    expect(assignedTask?.assignedAgentWorkflow).toBe("worker-flow");
    expect(assignedTask?.assignedAgentWorkflowId).toBe("worker-flow");
  });

  test("treats legacy debug-report executions as developer pull request completions", async () => {
    await createTestTask(db, "task-report", "repo-1", "docs/tasks/report", "DONE");
    await ctx.executionRepository.createExecution({
      id: "exec-report",
      task_id: "task-report",
      workflow_id: "debug-report",
      status: "completed",
      started_at: "2026-01-01T00:00:00.000Z",
      completed_at: "2026-01-01T00:01:00.000Z",
    });

    const status = await getServerStatus(ctx);
    const task = status.repos[0]?.tasks.find((item) => item.id === "task-report") as
      | { completionMode?: string }
      | undefined;

    expect(task?.completionMode).toBe("pull_request");
  });

  test("treats legacy release-bump executions as developer pull request completions", async () => {
    await createTestTask(db, "task-release", "repo-1", "docs/tasks/release", "DONE");
    await ctx.executionRepository.createExecution({
      id: "exec-release",
      task_id: "task-release",
      workflow_id: "release-bump",
      status: "completed",
      started_at: "2026-01-01T00:00:00.000Z",
      completed_at: "2026-01-01T00:01:00.000Z",
    });

    const status = await getServerStatus(ctx);
    const task = status.repos[0]?.tasks.find((item) => item.id === "task-release") as
      | { completionMode?: string }
      | undefined;

    expect(task?.completionMode).toBe("pull_request");
  });

  test("includes Linear source metadata for factory task cards", async () => {
    await createTestTask(db, "task-source", "repo-1", "docs/tasks/get-57-source", "READY");
    await db
      .insertInto("task_sources")
      .values({
        task_id: "task-source",
        repo_id: "repo-1",
        provider: "linear",
        external_id: "linear-issue-57",
        external_ref: "GET-57",
        external_url: "https://linear.app/get/issue/GET-57/dashboard",
        title_snapshot: "Agent swimlane software factory dashboard",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      })
      .execute();

    const status = await getServerStatus(ctx);
    const sourcedTask = status.repos[0]?.tasks.find((task) => task.id === "task-source");

    expect(sourcedTask?.sourceProvider).toBe("linear");
    expect(sourcedTask?.sourceRef).toBe("GET-57");
    expect(sourcedTask?.sourceUrl).toBe("https://linear.app/get/issue/GET-57/dashboard");
    expect(sourcedTask?.sourceTitle).toBe("Agent swimlane software factory dashboard");
  });

  test("includes projected runtime activity summaries", async () => {
    await createTestTask(db, "task-runtime", "repo-1", "docs/tasks/runtime", "WORKING");
    await ctx.executionRepository.createExecution({
      id: "exec-runtime",
      task_id: "task-runtime",
      status: "running",
      started_at: "2026-01-01T00:00:00.000Z",
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-runtime",
      execution_id: "exec-runtime",
      status: "running",
      started_at: "2026-01-01T00:00:00.000Z",
    });
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-runtime",
        content: JSON.stringify({
          provider: "pi",
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Projected update" }],
          },
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      },
    ]);

    const status = await getServerStatus(ctx);
    const runtimeTask = status.repos[0]?.tasks.find((task) => task.id === "task-runtime");

    expect(runtimeTask?.runtimeActivity?.latestMessage).toBe("Projected update");
    expect(runtimeTask?.runtimeActivity?.latestEventKind).toBe("assistant_text");
  });

  test("uses runtime working status to refine developer phase labels when the execution model is still at assignment time", async () => {
    const changePath = "docs/tasks/get-57-runtime-phase";
    await createTestTask(db, "task-3", "repo-1", changePath, "WORKING");

    await Bun.write(
      join(repoPath, changePath, "task.md"),
      serializeFrontmatter({
        frontmatter: {
          id: "task-3",
          title: "GET-57 runtime phase",
          status: "WORKING",
          created: "2026-03-31T00:00:00.000Z",
          changePath,
          execution: {
            version: 1,
            coordinationMode: "single-repository",
            coordinationPhase: "developers-assigned",
            architect: {
              agentId: "architect-1",
              role: "architect",
              repositories: [{ repoId: "repo-1", assignment: "control-plane" }],
            },
            developers: [
              {
                agentId: "developer-4",
                role: "developer",
                sliceId: "slice-runtime",
                lifecycle: "assigned",
                repositories: [{ repoId: "repo-1", assignment: "primary" }],
              },
            ],
          },
        },
        content: [
          "",
          "## Description",
          "Runtime phase refinement test.",
          "",
          "## Requirements",
          "",
          "## Acceptance Criteria",
          "- [ ] Show implementing once execution has started.",
          "",
        ].join("\n"),
      }),
    );

    const status = await getServerStatus(ctx);
    const runtimeTask = status.repos[0]?.tasks.find((task) => task.id === "task-3");

    expect(runtimeTask?.swimlane).toEqual({
      laneId: "developer-execution",
      phaseLabel: "Implementing",
      ownerLabel: "developer-4",
      ownerRole: "developer",
    });
  });
});
