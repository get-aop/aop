import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { approveHandoff, rejectHandoff } from "./handoff-approval.ts";

describe("handoff approval", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/repo-1");
    await createTestTask(db, "task-1", "repo-1", "docs/tasks/task-1", "DONE");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("approveHandoff clears the pending flag and writes human_approval evidence", async () => {
    const now = new Date().toISOString();
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: "completed",
      started_at: now,
      completed_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-exec-1",
      execution_id: "exec-1",
      step_id: "implement",
      step_type: "implement",
      agent_pid: null,
      session_id: null,
      status: "success",
      exit_code: 0,
      signal: "TASK_COMPLETE",
      pause_context: null,
      error: null,
      attempt: 1,
      iteration: 0,
      signals_json: null,
      started_at: now,
      ended_at: now,
    });
    await ctx.taskRepository.update("task-1", {
      handoff_pending_approval: true,
      worktree_path: null,
    });

    const result = await approveHandoff(ctx, "task-1");

    expect(result.success).toBe(true);
    const task = await ctx.taskRepository.get("task-1");
    expect(task?.handoff_pending_approval).toBe(false);
    const events = await ctx.runtimeEventRepository.listByTaskId("task-1");
    const approvalEvidence = events.find(
      (event) => event.kind === "verification_evidence_recorded" && event.status === "passed",
    );
    expect(approvalEvidence?.metadata?.evidence).toMatchObject({
      kind: "human_approval",
      status: "passed",
      summary: "Human approved handoff",
    });
  });

  test("approveHandoff fails when task is not pending approval", async () => {
    const result = await approveHandoff(ctx, "task-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected approveHandoff to fail");
    expect(result.error?.code).toBe("NOT_PENDING_APPROVAL");
  });

  test("approveHandoff fails when task not found", async () => {
    const result = await approveHandoff(ctx, "missing-task");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected approveHandoff to fail");
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  test("rejectHandoff returns task to DRAFT with reason", async () => {
    await ctx.taskRepository.update("task-1", {
      handoff_pending_approval: true,
    });

    const result = await rejectHandoff(ctx, "task-1", {
      action: "return_to_draft",
      reason: "Needs more work",
    });

    expect(result.success).toBe(true);
    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("DRAFT");
    expect(task?.handoff_pending_approval).toBe(false);
  });

  test("rejectHandoff blocks the task when action is block", async () => {
    await ctx.taskRepository.update("task-1", {
      handoff_pending_approval: true,
    });

    const result = await rejectHandoff(ctx, "task-1", {
      action: "block",
      reason: "Broken implementation",
    });

    expect(result.success).toBe(true);
    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("BLOCKED");
  });

  test("rejectHandoff fails when task is not pending approval", async () => {
    const result = await rejectHandoff(ctx, "task-1", {
      action: "return_to_draft",
      reason: "test",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected rejectHandoff to fail");
    expect(result.error?.code).toBe("NOT_PENDING_APPROVAL");
  });
});
