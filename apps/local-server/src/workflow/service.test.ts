// biome-ignore-all lint/style/noNonNullAssertion: workflow tests assert step and execution creation before dereferencing.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { useTestAopHome } from "@aop/infra";
import { type Kysely, sql } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { recordVerificationEvidence } from "../runtime-events/verification-evidence.ts";
import { listSignals } from "../signals/service.ts";
import { serializeFrontmatter } from "../task-docs/frontmatter.ts";
import { resolveTaskDir } from "../task-docs/paths.ts";
import { listBuiltInWorkflowFixtures } from "../workflow-engine/fixtures/built-in-workflows.ts";
import type { WorkflowDefinition } from "../workflow-engine/types.ts";

describe("LocalWorkflowService", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    await ctx.workflowRepository.upsert({
      id: "test-simple",
      name: "test-simple",
      definition: JSON.stringify({
        version: 1,
        name: "test-simple",
        initialStep: "implement",
        steps: {
          implement: {
            id: "implement",
            type: "implement",
            promptTemplate: "implement.md.hbs",
            maxAttempts: 1,
            transitions: [
              { condition: "success", target: "__done__" },
              { condition: "failure", target: "__blocked__" },
            ],
          },
        },
        terminalStates: ["__done__", "__blocked__"],
      }),
      source: "user",
    });
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("does not sync the retired built-in workflows into the local database", async () => {
    const workflows = await ctx.workflowService.listWorkflows();

    expect(workflows).toContain("test-simple");
    expect(workflows).not.toContain("aop-default-gpt");
    expect(workflows).not.toContain("aop-default-claude");
    expect(workflows).not.toContain("landing-page");

    const persisted = await ctx.workflowRepository.findByName("aop-default-gpt");
    expect(persisted).toBeNull();
  });

  test("starts the assigned worker workflow", async () => {
    const task = await createRepoTask("task-start", "test-simple");

    const result = await ctx.workflowService.startTask(task);

    expect(result.status).toBe("WORKING");
    expect(result.execution).toEqual({
      id: expect.any(String),
      workflowId: "test-simple",
    });
    expect(result.step?.stepId).toBe("implement");
    expect(result.step?.promptTemplate).toContain("You are");

    const execution = await ctx.executionRepository.getExecution(result.execution!.id);
    expect(execution?.visited_steps).toBe(JSON.stringify(["implement"]));
    expect(execution?.iteration).toBe(0);

    const steps = await ctx.executionRepository.getStepExecutionsByExecutionId(
      result.execution!.id,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual(
      expect.objectContaining({
        step_id: "implement",
        status: "running",
        attempt: 1,
        iteration: 0,
      }),
    );
  });

  test("preserves verification commands and accepts the legacy run_tests skill id", async () => {
    const workflow = await ctx.workflowService.createWorkflowFromSteps({
      name: "verify-flow",
      steps: [
        {
          id: "run-tests",
          skillId: "run_tests",
          verifyCommands: ["bun test apps/local-server/src/workflow/service.test.ts"],
        },
      ],
    });

    expect(workflow.steps[0]?.verifyCommands).toEqual([
      "bun test apps/local-server/src/workflow/service.test.ts",
    ]);
  });

  test("rejects unsafe verification commands when creating workflow steps", async () => {
    await expect(
      ctx.workflowService.createWorkflowFromSteps({
        name: "unsafe-verify-flow",
        steps: [
          {
            id: "run-tests",
            skillId: "run-tests",
            verifyCommands: ["bun test && rm -rf /tmp/aop"],
          },
        ],
      }),
    ).rejects.toThrow("Verification commands cannot contain shell control characters");
  });

  test("preserves checker step marker when creating workflow steps", async () => {
    const workflow = await ctx.workflowService.createWorkflowFromSteps({
      name: "checker-flow",
      steps: [
        {
          id: "review",
          skillId: "run-tests",
          checkerStep: true,
        },
      ],
    });

    expect(workflow.steps[0]?.checkerStep).toBe(true);
  });

  test("throws when task has no assigned worker with a workflow", async () => {
    const task = await createUnassignedRepoTask("task-unassigned");

    await expect(ctx.workflowService.startTask(task)).rejects.toThrow(
      "has no assigned worker with a workflow",
    );
  });

  test("starts the assigned worker workflow when stored by workflow name", async () => {
    const task = await createUnassignedRepoTask("task-worker-default");
    await createAssignedAgent(task.id, task.repo_id, "worker-1", "test-simple");

    const result = await ctx.workflowService.startTask(task);

    expect(result.status).toBe("WORKING");
    expect(result.execution).toEqual({
      id: expect.any(String),
      workflowId: "test-simple",
    });
    expect(result.step?.stepId).toBe("implement");
  });

  test("starts the assigned worker workflow when the agent stores a workflow database id", async () => {
    await ctx.workflowService.listWorkflows();
    const simpleWorkflow = await ctx.workflowRepository.findByName("test-simple");
    if (!simpleWorkflow) throw new Error("simple workflow should be synced");

    const task = await createUnassignedRepoTask("task-worker-default-by-id");
    await createAssignedAgent(task.id, task.repo_id, "worker-by-id", simpleWorkflow.id);

    const result = await ctx.workflowService.startTask(task);

    expect(result.status).toBe("WORKING");
    expect(result.execution).toEqual({
      id: expect.any(String),
      workflowId: "test-simple",
    });
    expect(result.step?.stepId).toBe("implement");
  });

  test("starts from retry_from_step using the previously visited path", async () => {
    const task = await createRepoTask("task-retry", "aop-default-gpt");
    await ctx.taskRepository.update(task.id, { retry_from_step: "nuclear_review" });
    await ctx.executionRepository.createExecution({
      id: "exec-old",
      task_id: task.id,
      workflow_id: "aop-default-gpt",
      status: "running",
      visited_steps: JSON.stringify([
        "implement",
        "run-tests",
        "cleanup-review",
        "nuclear_review",
        "fix-issues",
      ]),
      iteration: 2,
      started_at: new Date("2026-03-09T00:00:00.000Z").toISOString(),
    });

    const updatedTask = await getTask(task.id);
    const result = await ctx.workflowService.startTask(updatedTask);

    expect(result.step?.stepId).toBe("nuclear_review");
    expect(result.step?.iteration).toBe(2);

    const execution = await ctx.executionRepository.getExecution(result.execution!.id);
    expect(execution?.visited_steps).toBe(
      JSON.stringify(["implement", "run-tests", "simplification", "nuclear_review"]),
    );
    expect(execution?.iteration).toBe(2);
  });

  test("returns the stored task status when the step was already finalized", async () => {
    const task = await createRepoTask("task-finalized", "test-simple");
    await ctx.taskRepository.update(task.id, { status: "BLOCKED" });
    await ctx.executionRepository.createExecution({
      id: "exec-finalized",
      task_id: task.id,
      workflow_id: "test-simple",
      status: "running",
      visited_steps: JSON.stringify(["implement"]),
      iteration: 0,
      started_at: new Date().toISOString(),
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-finalized",
      execution_id: "exec-finalized",
      step_id: "implement",
      step_type: "implement",
      status: "success",
      started_at: new Date().toISOString(),
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: "exec-finalized",
      stepId: "step-finalized",
      status: "success",
    });

    expect(result).toEqual({ taskStatus: "BLOCKED", step: null });
  });

  test("marks a simple workflow task done after a successful step", async () => {
    const task = await createRepoTask("task-done", "test-simple");
    await writeTaskDoc(task, { criteriaChecked: true });
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result).toEqual({ taskStatus: "DONE", step: null });
    expect((await getTask(task.id)).status).toBe("DONE");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "completed",
    );
    expect((await ctx.executionRepository.getStepExecution(started.step!.id))?.status).toBe(
      "success",
    );
  });

  test("creates follow-up signals from successful completion output", async () => {
    const task = await createRepoTask("task-completion-signal", "test-simple");
    await writeTaskDoc(task, { criteriaChecked: true });
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
      assistantOutput: [
        "Implementation complete.",
        '<aop-signal kind="follow-up" confidence="high" title="Add release smoke test">',
        "Add a release smoke test for the updater endpoint.",
        "</aop-signal>",
      ].join("\n"),
    });

    const signals = await listSignals(ctx, { repoId: task.repo_id, openOnly: true });

    expect(result).toEqual({ taskStatus: "DONE", step: null });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      sourceTaskId: task.id,
      sourceExecutionId: started.execution!.id,
      kind: "follow-up",
      title: "Add release smoke test",
      body: "Add a release smoke test for the updater endpoint.",
      provenance: "aop",
      confidence: "high",
    });
  });

  test("blocks DONE when checker workflow has no checker evidence", async () => {
    await upsertWorkflow(createCheckerWorkflow("checker-missing-evidence"));
    const task = await createRepoTask("task-checker-missing", "checker-missing-evidence");
    await writeTaskDoc(task, { criteriaChecked: true });
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result.taskStatus).toBe("BLOCKED");
    expect(result.error?.code).toBe("checker_evidence_missing");
    expect((await getTask(task.id)).status).toBe("BLOCKED");
  });

  test("allows DONE when checker workflow has passed checker evidence", async () => {
    await upsertWorkflow(createCheckerWorkflow("checker-with-evidence"));
    const task = await createRepoTask("task-checker-evidence", "checker-with-evidence");
    await writeTaskDoc(task, { criteriaChecked: true });
    const started = await ctx.workflowService.startTask(task);
    await recordVerificationEvidence(ctx, {
      taskId: task.id,
      executionId: started.execution!.id,
      stepExecutionId: started.step!.id,
      evidence: {
        kind: "review_verdict",
        status: "passed",
        summary: "Checker approved the change",
        startedAt: "2026-04-01T00:00:00.000Z",
        endedAt: "2026-04-01T00:00:01.000Z",
      },
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result).toEqual({ taskStatus: "DONE", step: null });
    expect((await getTask(task.id)).status).toBe("DONE");
  });

  test("checks the generated completion criterion after passed checker evidence", async () => {
    await upsertWorkflow(createCheckerWorkflow("checker-generated-criterion"));
    const task = await createRepoTask("task-generated-criterion", "checker-generated-criterion");
    await writeTaskDoc(task, {
      acceptanceCriteria: ["Complete and verify every acceptance criterion in `issues.md`."],
    });
    const started = await ctx.workflowService.startTask(task);
    await recordVerificationEvidence(ctx, {
      taskId: task.id,
      executionId: started.execution!.id,
      stepExecutionId: started.step!.id,
      evidence: {
        kind: "review_verdict",
        status: "passed",
        summary: "Checker approved the change",
        startedAt: "2026-04-01T00:00:00.000Z",
        endedAt: "2026-04-01T00:00:01.000Z",
      },
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result).toEqual({ taskStatus: "DONE", step: null });
    expect(await Bun.file(join(await getTaskDir(task), "task.md")).text()).toContain(
      "- [x] Complete and verify every acceptance criterion in `issues.md`.",
    );
  });

  test("keeps custom acceptance criteria blocking after checker evidence passes", async () => {
    await upsertWorkflow(createCheckerWorkflow("checker-custom-criterion"));
    const task = await createRepoTask("task-custom-criterion", "checker-custom-criterion");
    await writeTaskDoc(task, {
      acceptanceCriteria: [
        "Complete and verify every acceptance criterion in `issues.md`.",
        "Confirm the production rollout",
      ],
    });
    const started = await ctx.workflowService.startTask(task);
    await recordVerificationEvidence(ctx, {
      taskId: task.id,
      executionId: started.execution!.id,
      stepExecutionId: started.step!.id,
      evidence: {
        kind: "review_verdict",
        status: "passed",
        summary: "Checker approved the implementation",
        startedAt: "2026-04-01T00:00:00.000Z",
        endedAt: "2026-04-01T00:00:01.000Z",
      },
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result).toEqual({
      taskStatus: "BLOCKED",
      step: null,
      error: {
        code: "completion_guard_failed",
        message: "1 unchecked acceptance criterion: Confirm the production rollout",
      },
    });
    const taskMarkdown = await Bun.file(join(await getTaskDir(task), "task.md")).text();
    expect(taskMarkdown).toContain(
      "- [x] Complete and verify every acceptance criterion in `issues.md`.",
    );
    expect(taskMarkdown).toContain("- [ ] Confirm the production rollout");
  });

  test("blocks continuation when task exceeds cost budget", async () => {
    await ctx.settingsRepository.set("budget_cost_usd", "0.001");
    const task = await createRepoTask("task-budget-cost", "test-simple");
    await writeTaskDoc(task, { criteriaChecked: true });
    const started = await ctx.workflowService.startTask(task);
    await ctx.executionRepository.saveStepUsage({
      step_execution_id: started.step!.id,
      provider: "pi",
      model: "gpt-5.5",
      input_tokens: 1000,
      output_tokens: 500,
      total_tokens: 1500,
      cost_usd: 0.05,
      duration_ms: 5000,
      usage_source: "provider_log",
      raw_usage_json: null,
      created_at: new Date().toISOString(),
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result.taskStatus).toBe("BLOCKED");
    expect(result.error?.code).toBe("budget_exceeded");
  });

  test("blocks continuation when task exceeds token budget", async () => {
    await ctx.settingsRepository.set("budget_total_tokens", "100");
    const task = await createRepoTask("task-budget-tokens", "test-simple");
    await writeTaskDoc(task, { criteriaChecked: true });
    const started = await ctx.workflowService.startTask(task);
    await ctx.executionRepository.saveStepUsage({
      step_execution_id: started.step!.id,
      provider: "pi",
      model: "gpt-5.5",
      input_tokens: 500,
      output_tokens: 200,
      total_tokens: 700,
      cost_usd: null,
      duration_ms: 3000,
      usage_source: "provider_log",
      raw_usage_json: null,
      created_at: new Date().toISOString(),
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result.taskStatus).toBe("BLOCKED");
    expect(result.error?.code).toBe("budget_exceeded");
  });

  test("blocks continuation when task exceeds wall-clock budget", async () => {
    await ctx.settingsRepository.set("budget_wall_clock_secs", "1");
    const task = await createRepoTask("task-budget-wallclock", "test-simple");
    await writeTaskDoc(task, { criteriaChecked: true });
    const started = await ctx.workflowService.startTask(task);
    await ctx.executionRepository.saveStepUsage({
      step_execution_id: started.step!.id,
      provider: null,
      model: null,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      cost_usd: null,
      duration_ms: 5000,
      usage_source: "wall_clock",
      raw_usage_json: null,
      created_at: new Date().toISOString(),
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result.taskStatus).toBe("BLOCKED");
    expect(result.error?.code).toBe("budget_exceeded");
  });

  test("allows continuation when budget is zero (disabled)", async () => {
    const task = await createRepoTask("task-budget-disabled", "test-simple");
    await writeTaskDoc(task, { criteriaChecked: true });
    const started = await ctx.workflowService.startTask(task);
    await ctx.executionRepository.saveStepUsage({
      step_execution_id: started.step!.id,
      provider: "pi",
      model: "gpt-5.5",
      input_tokens: 999999,
      output_tokens: 999999,
      total_tokens: 1999998,
      cost_usd: 999.99,
      duration_ms: 999999,
      usage_source: "provider_log",
      raw_usage_json: null,
      created_at: new Date().toISOString(),
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result.taskStatus).toBe("DONE");
  });

  test("returns tasks to draft when a workflow reaches the draft terminal state", async () => {
    await upsertWorkflow({
      version: 1,
      name: "draft-terminal-flow",
      initialStep: "revise-plan",
      steps: {
        "revise-plan": {
          id: "revise-plan",
          type: "iterate",
          promptTemplate: "iterate.md.hbs",
          maxAttempts: 1,
          signals: [{ name: "PLAN_UPDATED", description: "placeholder" }],
          transitions: [{ condition: "PLAN_UPDATED", target: "__draft__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__", "__paused__", "__draft__"],
    });

    const task = await createRepoTask("task-plan-review-draft", "draft-terminal-flow");
    await ctx.taskRepository.update(task.id, {
      ready_at: "2026-05-24T10:00:00.000Z",
      worktree_path: "/tmp/aop-worktree",
    });
    const started = await ctx.workflowService.startTask(await getTask(task.id));

    const result = await ctx.workflowService.completeStep(await getTask(task.id), {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
      signal: "PLAN_UPDATED",
    });

    const updatedTask = await getTask(task.id);
    expect(result).toEqual({ taskStatus: "DRAFT", step: null });
    expect(updatedTask.status).toBe("DRAFT");
    expect(updatedTask.resume_input).toBeNull();
    expect(updatedTask.ready_at).toBeNull();
    expect(updatedTask.worktree_path).toBeNull();
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "completed",
    );
  });

  test("allows terminal completion when task docs have no acceptance criteria or subtasks", async () => {
    const task = await createRepoTask("task-server-status", "test-simple");
    await writeTaskDoc(task, { acceptanceCriteria: [] });
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result).toEqual({ taskStatus: "DONE", step: null });
    expect((await getTask(task.id)).status).toBe("DONE");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "completed",
    );
  });

  test("blocks terminal completion when acceptance criteria are unchecked", async () => {
    const task = await createRepoTask("task-unchecked-criteria", "test-simple");
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result).toEqual({
      taskStatus: "BLOCKED",
      step: null,
      error: {
        code: "completion_guard_failed",
        message: "1 unchecked acceptance criterion: Define acceptance criteria",
      },
    });
    expect((await getTask(task.id)).status).toBe("BLOCKED");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "failed",
    );
    const events = await ctx.runtimeEventRepository.listByTaskId(task.id);
    expect(events).toContainEqual(
      expect.objectContaining({
        executionId: started.execution!.id,
        stepExecutionId: started.step!.id,
        kind: "task_blocked",
        title: "Completion guard blocked task-unchecked-criteria",
        message: "1 unchecked acceptance criterion: Define acceptance criteria",
        metadata: {
          code: "completion_guard_failed",
          retryFromStep: "implement",
          reasons: ["1 unchecked acceptance criterion: Define acceptance criteria"],
        },
      }),
    );
    const signals = await listSignals(ctx, { repoId: task.repo_id, openOnly: true });
    expect(signals).toContainEqual(
      expect.objectContaining({
        sourceTaskId: task.id,
        sourceExecutionId: started.execution!.id,
        kind: "regression",
        provenance: "aop",
        confidence: "high",
        title: "Completion guard blocked task-unchecked-criteria",
      }),
    );
  });

  test("blocks terminal completion when subtasks are unfinished", async () => {
    const task = await createRepoTask("task-unfinished-subtasks", "test-simple");
    await writeTaskDoc(task, { criteriaChecked: true });
    const started = await ctx.workflowService.startTask(task);
    await writeSubtaskDoc(task, "001-done.md", "DONE");
    await writeSubtaskDoc(task, "002-pending.md", "PENDING");

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result).toEqual({
      taskStatus: "BLOCKED",
      step: null,
      error: {
        code: "completion_guard_failed",
        message: "1 unfinished subtask doc: 002-pending.md (PENDING)",
      },
    });
    expect((await getTask(task.id)).status).toBe("BLOCKED");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "failed",
    );
  });

  test("marks a simple workflow task blocked after a failed step", async () => {
    const task = await createRepoTask("task-blocked", "test-simple");
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "failure",
    });

    expect(result).toEqual({
      taskStatus: "BLOCKED",
      step: null,
      error: {
        code: "max_retries_exceeded",
        message: "Workflow blocked after step failure",
      },
    });
    expect((await getTask(task.id)).status).toBe("BLOCKED");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "failed",
    );
  });

  test("advances aop-default-gpt implementation to tests on plain success", async () => {
    const task = await createRepoTask("task-aop-default-gpt-signal", "aop-default-gpt");
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result.taskStatus).toBe("WORKING");
    expect(result.step?.stepId).toBe("run-tests");
    expect((await ctx.executionRepository.getStepExecution(started.step!.id))?.signal).toBeNull();
  });

  test("records a required-signal failure when tests finish without a signal", async () => {
    const task = await createRepoTask("task-aop-default-gpt-missing-signal", "aop-default-gpt");
    const started = await ctx.workflowService.startTask(task);
    const testsStarted = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: testsStarted.step!.id,
      status: "success",
    });

    expect(result).toEqual({
      taskStatus: "BLOCKED",
      step: null,
      error: {
        code: "missing_required_signal",
        message:
          'Step "run-tests" completed without a required workflow signal. Expected one of: TESTS_FAIL, TESTS_PASS. Verification may still be running or the agent ended before reporting its result.',
      },
    });
    expect((await getTask(task.id)).status).toBe("BLOCKED");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "failed",
    );
    expect((await ctx.executionRepository.getStepExecution(testsStarted.step!.id))?.status).toBe(
      "failure",
    );

    const events = await ctx.runtimeEventRepository.listByTaskId(task.id);
    expect(events).toContainEqual(
      expect.objectContaining({
        executionId: started.execution!.id,
        stepExecutionId: testsStarted.step!.id,
        kind: "task_blocked",
        title: "Required workflow signal missing from run-tests",
        metadata: {
          code: "missing_required_signal",
          stepId: "run-tests",
          retryFromStep: "run-tests",
          expectedSignals: ["TESTS_FAIL", "TESTS_PASS"],
        },
      }),
    );
    const signals = await listSignals(ctx, { repoId: task.repo_id, openOnly: true });
    expect(signals).toContainEqual(
      expect.objectContaining({
        sourceTaskId: task.id,
        sourceExecutionId: started.execution!.id,
        kind: "regression",
        confidence: "high",
        title: `Required workflow signal missing for ${task.id}`,
      }),
    );
  });

  test("blocks even when the missing-signal runtime event cannot be recorded", async () => {
    const task = await createRepoTask("task-missing-signal-event-failure", "aop-default-gpt");
    const started = await ctx.workflowService.startTask(task);
    const testsStarted = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });
    Object.defineProperty(ctx.runtimeEventRepository, "insertMany", {
      configurable: true,
      value: async () => {
        throw new Error("runtime event unavailable");
      },
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: testsStarted.step!.id,
      status: "success",
    });

    expect(result.taskStatus).toBe("BLOCKED");
    expect((await getTask(task.id)).status).toBe("BLOCKED");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "failed",
    );
    const signals = await listSignals(ctx, { repoId: task.repo_id, openOnly: true });
    expect(signals.some((signal) => signal.sourceTaskId === task.id)).toBe(true);
  });

  test("blocks even when the missing-signal blocker signal cannot be recorded", async () => {
    const task = await createRepoTask("task-missing-signal-signal-failure", "aop-default-gpt");
    const started = await ctx.workflowService.startTask(task);
    const testsStarted = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });
    await sql`CREATE TRIGGER reject_missing_signal
      BEFORE INSERT ON signals
      BEGIN
        SELECT RAISE(FAIL, 'signal unavailable');
      END`.execute(db);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: testsStarted.step!.id,
      status: "success",
    });

    expect(result.taskStatus).toBe("BLOCKED");
    expect((await getTask(task.id)).status).toBe("BLOCKED");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "failed",
    );
    const events = await ctx.runtimeEventRepository.listByTaskId(task.id);
    expect(events.some((event) => event.metadata?.code === "missing_required_signal")).toBe(true);
  });

  test("continues to the next step and updates visited steps", async () => {
    await upsertWorkflow({
      version: 1,
      name: "research-flow",
      initialStep: "codebase_research",
      steps: {
        codebase_research: {
          id: "codebase_research",
          type: "research",
          promptTemplate: "codebase-research.md.hbs",
          maxAttempts: 1,
          signals: [{ name: "RESEARCH_COMPLETE", description: "placeholder" }],
          transitions: [{ condition: "RESEARCH_COMPLETE", target: "research" }],
        },
        research: {
          id: "research",
          type: "research",
          promptTemplate: "codebase-research.md.hbs",
          maxAttempts: 1,
          signals: [{ name: "RESEARCH_COMPLETE", description: "placeholder" }],
          transitions: [{ condition: "RESEARCH_COMPLETE", target: "__done__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__", "__paused__"],
    });

    const task = await createRepoTask("task-step", "research-flow");
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
      signal: "RESEARCH_COMPLETE",
    });

    expect(result.taskStatus).toBe("WORKING");
    expect(result.execution).toEqual({
      id: started.execution!.id,
      workflowId: "research-flow",
    });
    expect(result.step?.stepId).toBe("research");

    const execution = await ctx.executionRepository.getExecution(started.execution!.id);
    expect(execution?.visited_steps).toBe(JSON.stringify(["codebase_research", "research"]));
    expect(execution?.iteration).toBe(0);
    expect((await getTask(task.id)).status).toBe("WORKING");
  });

  test("pauses a workflow and resumes from the awaiting-input step", async () => {
    await upsertWorkflow({
      version: 1,
      name: "pause-flow",
      initialStep: "visual_verify",
      steps: {
        visual_verify: {
          id: "visual_verify",
          type: "review",
          promptTemplate: "visual-verify.md.hbs",
          maxAttempts: 1,
          signals: [{ name: "REQUIRES_INPUT", description: "placeholder" }],
          transitions: [{ condition: "REQUIRES_INPUT", target: "__paused__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__", "__paused__"],
    });

    const task = await createRepoTask("task-pause", "pause-flow");
    const started = await ctx.workflowService.startTask(task);

    const paused = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
      signal: "REQUIRES_INPUT",
      pauseContext: "INPUT_REASON: Need clarification for API_KEY=sk-live-secret\nINPUT_TYPE: text",
    });

    expect(paused).toEqual({ taskStatus: "PAUSED", step: null });
    expect((await getTask(task.id)).status).toBe("PAUSED");
    expect((await ctx.executionRepository.getStepExecution(started.step!.id))?.status).toBe(
      "awaiting_input",
    );
    expect((await ctx.executionRepository.getStepExecution(started.step!.id))?.pause_context).toBe(
      "INPUT_REASON: Need clarification for API_KEY=sk-live-secret\nINPUT_TYPE: text",
    );
    const resumeContext = await Bun.file(join(await getTaskDir(task), "resume-context.md")).text();
    expect(resumeContext).toContain("# Resume Context");
    expect(resumeContext).toContain("Reference existing task docs and execution logs by path");
    expect(resumeContext).toContain("Redact secrets before persisting");
    expect(resumeContext).toContain("Suggested next states");
    expect(resumeContext).toContain("INPUT_REASON: Need clarification for API_KEY=[REDACTED]");
    expect(resumeContext).not.toContain("sk-live-secret");
    await ctx.executionRepository.updateStepExecution(started.step!.id, {
      session_id: "runtime-session-1",
    });

    const resumed = await ctx.workflowService.resumeTask(task, started.step!.id, "continue");

    expect(resumed.taskStatus).toBe("WORKING");
    expect(resumed.execution).toEqual({
      id: started.execution!.id,
      workflowId: "pause-flow",
    });
    expect(resumed.step?.stepId).toBe("visual_verify");
    expect(resumed.step?.input).toBe("continue");
    expect(resumed.step?.resumeSessionId).toBe("runtime-session-1");
    expect((await getTask(task.id)).status).toBe("WORKING");
    expect((await getTask(task.id)).resume_input).toBeNull();
    expect(
      (await ctx.executionRepository.getStepExecutionsByExecutionId(started.execution!.id)).length,
    ).toBe(2);
  });

  test("throws when retry_from_step does not exist in the workflow", async () => {
    const task = await createRepoTask("task-bad-retry", "test-simple");
    await ctx.taskRepository.update(task.id, { retry_from_step: "missing-step" });

    const updatedTask = await getTask(task.id);

    await expect(ctx.workflowService.startTask(updatedTask)).rejects.toThrow(
      'Step "missing-step" not found in workflow "test-simple"',
    );
  });

  const writeSubtaskDoc = async (
    task: Task,
    filename: string,
    status: "DONE" | "PENDING",
  ): Promise<void> => {
    await Bun.write(
      join(await getTaskDir(task), filename),
      serializeFrontmatter({
        frontmatter: {
          title: filename,
          status,
          dependencies: [],
        },
        content: ["", "### Description", filename, ""].join("\n"),
      }),
    );
  };

  const writeTaskDoc = async (
    task: Task,
    options: { acceptanceCriteria?: string[]; criteriaChecked?: boolean } = {},
  ): Promise<void> => {
    const criteria = options.acceptanceCriteria ?? ["Completed"];
    const checklist = criteria.map(
      (criterion) => `- [${options.criteriaChecked ? "x" : " "}] ${criterion}`,
    );
    await Bun.write(
      join(await getTaskDir(task), "task.md"),
      serializeFrontmatter({
        frontmatter: {
          id: task.id,
          title: task.id,
          status: task.status,
          created: task.created_at,
          changePath: task.change_path,
        },
        content: [
          "",
          "## Description",
          task.id,
          "",
          "## Requirements",
          "",
          "## Acceptance Criteria",
          ...checklist,
          "",
        ].join("\n"),
      }),
    );
  };

  const getTaskDir = async (task: Task): Promise<string> => {
    const repo = await ctx.repoRepository.getById(task.repo_id);
    if (!repo) {
      throw new Error(`Repo ${task.repo_id} not found`);
    }
    return resolveTaskDir(task.repo_id, repo.path, task.change_path);
  };

  const createRepoTask = async (taskId: string, workflowName: string): Promise<Task> => {
    await createTestRepo(db, `repo-${taskId}`, `/tmp/${taskId}`);
    await createTestTask(db, taskId, `repo-${taskId}`, `changes/${taskId}`, "READY");
    await createAssignedAgent(taskId, `repo-${taskId}`, `agent-${taskId}`, workflowName);
    return getTask(taskId);
  };

  const createUnassignedRepoTask = async (taskId: string): Promise<Task> => {
    await createTestRepo(db, `repo-${taskId}`, `/tmp/${taskId}`);
    await createTestTask(db, taskId, `repo-${taskId}`, `changes/${taskId}`, "READY");
    return getTask(taskId);
  };

  const createAssignedAgent = async (
    taskId: string,
    repoId: string,
    agentId: string,
    workflowId: string,
  ): Promise<void> => {
    const now = new Date().toISOString();
    // Retired built-in workflow names resolve to their fixture shape so tests
    // that exercise the default-loop behavior keep running against real steps.
    const fixture = listBuiltInWorkflowFixtures().find((wf) => wf.name === workflowId);
    await db
      .insertInto("workflows")
      .values({
        id: workflowId,
        name: workflowId,
        definition: fixture ? JSON.stringify(fixture) : "{}",
      })
      .onConflict((oc) => oc.column("id").doNothing())
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
        repo_id: repoId,
        membership_role: "primary",
        created_at: now,
      })
      .execute();
    await ctx.taskAssignmentRepository.upsertCurrent({
      taskId,
      agentId,
      repoId,
      statusColumn: "READY",
    });
  };

  const getTask = async (taskId: string): Promise<Task> => {
    const task = await ctx.taskRepository.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return task;
  };

  const upsertWorkflow = async (workflow: WorkflowDefinition): Promise<void> => {
    await ctx.workflowService.listWorkflows();
    await ctx.workflowRepository.upsert({
      id: workflow.name,
      name: workflow.name,
      definition: JSON.stringify(workflow),
    });
  };

  const createCheckerWorkflow = (name: string): WorkflowDefinition => ({
    version: 1,
    name,
    initialStep: "review",
    steps: {
      review: {
        id: "review",
        type: "review",
        promptTemplate: "review.md.hbs",
        maxAttempts: 1,
        checkerStep: true,
        transitions: [{ condition: "success", target: "__done__" }],
      },
    },
    terminalStates: ["__done__", "__blocked__", "__paused__"],
  });
});
