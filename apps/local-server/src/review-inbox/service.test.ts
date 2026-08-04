import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createSignal } from "../signals/service.ts";
import { listReviewInboxItems } from "./service.ts";

describe("review inbox service", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/repo-1");
    await createTestRepo(db, "repo-2", "/tmp/repo-2");
    await db
      .insertInto("workflows")
      .values({ id: "workflow-1", name: "Test Workflow", definition: "{}" })
      .execute();
    await db
      .insertInto("agents")
      .values({
        id: "agent-1",
        name: "Worker One",
        role: "developer",
        runtime_provider: "opencode",
        provider: "opencode",
        model: "gpt-5.5",
        workflow_id: "workflow-1",
        status: "active",
        artifact_path: "agents/agent-1.md",
        source_kind: "manual",
      })
      .execute();
    await createTestTask(db, "task-1", "repo-1", "docs/tasks/task-1", "DONE");
    await createTestTask(db, "task-2", "repo-2", "docs/tasks/task-2", "WORKING");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("lists handoff approvals as actionable inbox items", async () => {
    await ctx.taskRepository.update("task-1", { handoff_pending_approval: true });
    await ctx.taskAssignmentRepository.upsertCurrent({
      taskId: "task-1",
      agentId: "agent-1",
      repoId: "repo-1",
      statusColumn: "DONE",
    });

    const items = await listReviewInboxItems(ctx, { workerId: "agent-1", severity: "medium" });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "handoff_approval",
      severity: "medium",
      source: "approval",
      taskId: "task-1",
      repoId: "repo-1",
      workerId: "agent-1",
      title: "Completion awaiting approval",
    });
  });

  test("lists failed verification evidence and supports repo filtering", async () => {
    const now = new Date().toISOString();
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-2",
      status: "failed",
      started_at: now,
      completed_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      step_id: "verify",
      step_type: "verify",
      agent_pid: null,
      session_id: null,
      status: "failure",
      exit_code: 1,
      signal: null,
      pause_context: null,
      error: null,
      attempt: 1,
      iteration: 0,
      signals_json: null,
      started_at: now,
      ended_at: now,
    });
    await ctx.runtimeEventRepository.insertMany([
      {
        id: randomUUID(),
        task_id: "task-2",
        execution_id: "exec-1",
        step_execution_id: "step-1",
        session_id: null,
        agent_id: null,
        kind: "verification_evidence_recorded",
        title: "Verification failed",
        message: "bun test failed",
        tool_name: null,
        status: "failed",
        source_kind: "verification_evidence",
        source_id: "step-1:test_command:bun-test",
        source_index: 0,
        occurred_at: now,
        metadata_json: JSON.stringify({ evidence: { kind: "test_command" } }),
      },
    ]);

    const repoTwoItems = await listReviewInboxItems(ctx, { repoId: "repo-2" });
    const repoOneItems = await listReviewInboxItems(ctx, { repoId: "repo-1" });

    expect(repoTwoItems).toHaveLength(1);
    expect(repoTwoItems[0]).toMatchObject({
      type: "failed_verification",
      severity: "high",
      source: "runtime_event",
      taskId: "task-2",
      executionId: "exec-1",
      stepExecutionId: "step-1",
      evidenceKind: "test_command",
    });
    expect(repoOneItems).toHaveLength(0);
  });

  test("lists budget exceeded blocker events from event metadata codes", async () => {
    const now = new Date().toISOString();
    await ctx.executionRepository.createExecution({
      id: "exec-budget",
      task_id: "task-2",
      status: "failed",
      started_at: now,
      completed_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-budget",
      execution_id: "exec-budget",
      step_id: "implement",
      step_type: "implement",
      agent_pid: null,
      session_id: null,
      status: "failure",
      exit_code: 1,
      signal: null,
      pause_context: null,
      error: null,
      attempt: 1,
      iteration: 0,
      signals_json: null,
      started_at: now,
      ended_at: now,
    });
    await ctx.runtimeEventRepository.insertMany([
      {
        id: randomUUID(),
        task_id: "task-2",
        execution_id: "exec-budget",
        step_execution_id: "step-budget",
        session_id: null,
        agent_id: null,
        kind: "task_blocked",
        title: "Budget exceeded",
        message: "tokens 700 exceed ceiling 100",
        tool_name: null,
        status: "blocked",
        source_kind: "workflow",
        source_id: "exec-budget:budget_exceeded",
        source_index: 0,
        occurred_at: now,
        metadata_json: JSON.stringify({ code: "budget_exceeded" }),
      },
    ]);

    const items = await listReviewInboxItems(ctx, { source: "runtime_event" });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "blocked_budget",
      severity: "high",
      source: "runtime_event",
      taskId: "task-2",
      executionId: "exec-budget",
      title: "Budget exceeded",
    });
  });

  test("deduplicates AOP blocker signals already represented by runtime events", async () => {
    const now = new Date().toISOString();
    await ctx.executionRepository.createExecution({
      id: "exec-guard",
      task_id: "task-2",
      status: "failed",
      started_at: now,
      completed_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-guard",
      execution_id: "exec-guard",
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
    await ctx.runtimeEventRepository.insertMany([
      {
        id: randomUUID(),
        task_id: "task-2",
        execution_id: "exec-guard",
        step_execution_id: "step-guard",
        session_id: null,
        agent_id: null,
        kind: "task_blocked",
        title: "Completion guard blocked task-2",
        message: "1 unchecked acceptance criterion",
        tool_name: null,
        status: "blocked",
        source_kind: "workflow",
        source_id: "exec-guard:completion_guard",
        source_index: 0,
        occurred_at: now,
        metadata_json: JSON.stringify({
          code: "completion_guard_failed",
          retryFromStep: "implement",
        }),
      },
    ]);
    await createSignal(ctx, {
      repoId: "repo-2",
      sourceTaskId: "task-2",
      sourceExecutionId: "exec-guard",
      kind: "regression",
      title: "Completion guard blocked task-2",
      body: "1 unchecked acceptance criterion",
      provenance: "aop",
      confidence: "high",
    });

    const items = await listReviewInboxItems(ctx);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "guard_failure",
      source: "runtime_event",
      taskId: "task-2",
      executionId: "exec-guard",
      retryFromStep: "implement",
    });
  });

  test("deduplicates missing-signal mirrors and keeps the retry step", async () => {
    const now = new Date().toISOString();
    await ctx.executionRepository.createExecution({
      id: "exec-missing-signal",
      task_id: "task-2",
      status: "failed",
      started_at: now,
      completed_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-missing-signal",
      execution_id: "exec-missing-signal",
      step_id: "run-tests",
      step_type: "test",
      agent_pid: null,
      session_id: null,
      status: "failure",
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
    await ctx.runtimeEventRepository.insertMany([
      {
        id: randomUUID(),
        task_id: "task-2",
        execution_id: "exec-missing-signal",
        step_execution_id: "step-missing-signal",
        session_id: null,
        agent_id: null,
        kind: "task_blocked",
        title: "Required workflow signal missing from run-tests",
        message: "Expected TESTS_PASS or TESTS_FAIL",
        tool_name: null,
        status: "blocked",
        source_kind: "workflow",
        source_id: "exec-missing-signal:missing_required_signal",
        source_index: 0,
        occurred_at: now,
        metadata_json: JSON.stringify({
          code: "missing_required_signal",
          retryFromStep: "run-tests",
        }),
      },
    ]);
    await createSignal(ctx, {
      repoId: "repo-2",
      sourceTaskId: "task-2",
      sourceExecutionId: "exec-missing-signal",
      kind: "regression",
      title: "Required workflow signal missing for task-2",
      body: "Expected TESTS_PASS or TESTS_FAIL",
      provenance: "aop",
      confidence: "high",
    });

    const items = await listReviewInboxItems(ctx);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "guard_failure",
      source: "runtime_event",
      taskId: "task-2",
      executionId: "exec-missing-signal",
      retryFromStep: "run-tests",
    });
  });

  test("does not list runtime blockers for completed tasks", async () => {
    const now = new Date().toISOString();
    await ctx.executionRepository.createExecution({
      id: "exec-done-blocker",
      task_id: "task-1",
      status: "failed",
      started_at: now,
      completed_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-done-blocker",
      execution_id: "exec-done-blocker",
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
    await ctx.runtimeEventRepository.insertMany([
      {
        id: randomUUID(),
        task_id: "task-1",
        execution_id: "exec-done-blocker",
        step_execution_id: "step-done-blocker",
        session_id: null,
        agent_id: null,
        kind: "task_blocked",
        title: "Completion guard blocked task-1",
        message: "Historical blocker",
        tool_name: null,
        status: "blocked",
        source_kind: "workflow",
        source_id: "exec-done-blocker:completion_guard",
        source_index: 0,
        occurred_at: now,
        metadata_json: JSON.stringify({ code: "completion_guard_failed" }),
      },
    ]);

    const items = await listReviewInboxItems(ctx, { source: "runtime_event" });

    expect(items).toHaveLength(0);
  });

  test("lists unconsumed signals as generated follow-up inbox items", async () => {
    const signal = await createSignal(ctx, {
      repoId: "repo-1",
      sourceTaskId: "task-1",
      kind: "follow-up",
      title: "Add a migration note",
      body: "The completed work needs a release note.",
      provenance: "aop",
      confidence: "high",
    });

    const items = await listReviewInboxItems(ctx, { source: "signal" });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: `signal:${signal.id}`,
      type: "generated_follow_up",
      severity: "medium",
      source: "signal",
      taskId: "task-1",
      triggerId: signal.id,
    });
  });

  test("lists scheduler failures from trigger results", async () => {
    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "nightly import",
      action: "re_import_tracker",
      cadenceSecs: 60,
      enabled: true,
    });
    await ctx.schedulerRepository.update(trigger.id, {
      last_run_at: "2026-06-24T12:00:00.000Z",
      last_result_json: JSON.stringify({
        triggerId: trigger.id,
        action: "re_import_tracker",
        promoted: 0,
        skipped: 0,
        error: "tracker_unavailable",
      }),
    });

    const items = await listReviewInboxItems(ctx, { source: "scheduler" });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: `scheduler:${trigger.id}`,
      type: "schedule_error",
      severity: "medium",
      source: "scheduler",
      repoId: "repo-1",
      taskId: `scheduler:${trigger.id}`,
      triggerId: trigger.id,
      title: "Scheduler failed: nightly import",
      message: "tracker_unavailable",
    });
  });
});
