import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepCommand } from "@aop/common/protocol";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import type { ExecuteResult, ExecutorContext } from "./types.ts";
import { applyVerificationCommands } from "./verification-commands.ts";

describe("applyVerificationCommands", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let tempDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    tempDir = await mkdtemp(join(tmpdir(), "aop-verify-commands-"));
    await createTestRepo(db, "repo-verify", join(tempDir, "repo"));
    await createTestTask(db, "task-verify", "repo-verify", "changes/task-verify", "WORKING");
    await ctx.executionRepository.createExecution({
      id: "exec-verify",
      task_id: "task-verify",
      status: "running",
      started_at: "2026-06-24T12:00:00.000Z",
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-verify",
      execution_id: "exec-verify",
      step_id: "run-tests",
      step_type: "test",
      status: "running",
      started_at: "2026-06-24T12:00:00.000Z",
    });
  });

  afterEach(async () => {
    await db.destroy();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("records passing evidence and keeps a successful result successful", async () => {
    const result = await applyVerificationCommands({
      ctx,
      executorCtx: makeExecutorContext(),
      executionId: "exec-verify",
      stepId: "step-verify",
      stepCommand: makeStepCommand(["printf verification-ok"]),
      result: makeSuccessfulResult(),
    });

    expect(result.status).toBe("success");
    const events = await ctx.runtimeEventRepository.listByTaskId("task-verify");
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "verification_evidence_recorded",
        status: "passed",
        message: "Verification command passed: printf verification-ok",
        metadata: expect.objectContaining({
          evidence: expect.objectContaining({
            kind: "test_command",
            command: "printf verification-ok",
            status: "passed",
            exitCode: 0,
          }),
        }),
      }),
    );
  });

  test("records failed evidence and turns the result into a failed step", async () => {
    const result = await applyVerificationCommands({
      ctx,
      executorCtx: makeExecutorContext(),
      executionId: "exec-verify",
      stepId: "step-verify",
      stepCommand: makeStepCommand(["false"]),
      result: makeSuccessfulResult(),
    });

    expect(result.status).toBe("failure");
    expect(result.exitCode).toBe(1);
    expect(result.signal).toBeUndefined();
    expect(result.assistantOutput).toContain("Verification command failed (1): false");

    const events = await ctx.runtimeEventRepository.listByTaskId("task-verify");
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "verification_evidence_recorded",
        status: "failed",
        message: "Verification command failed (1): false",
      }),
    );
  });

  const makeExecutorContext = (): ExecutorContext => ({
    task: {
      id: "task-verify",
      repo_id: "repo-verify",
      change_path: "changes/task-verify",
      branch_name: null,
      worktree_path: tempDir,
      status: "WORKING",
      ready_at: null,
      preferred_workflow: null,
      base_branch: null,
      preferred_provider: null,
      retry_from_step: null,
      resume_input: null,
      archived_at: null,
      handoff_pending_approval: false,
      handoff_requires_approval_override: null,
      origin_chat_session_id: null,
      created_at: "2026-06-24T12:00:00.000Z",
      updated_at: "2026-06-24T12:00:00.000Z",
    },
    repoId: "repo-verify",
    repoPath: join(tempDir, "repo"),
    changePath: join(tempDir, "repo", "changes/task-verify"),
    worktreePath: tempDir,
    logsDir: join(tempDir, "logs"),
    timeoutSecs: 30,
    fastMode: false,
  });

  const makeStepCommand = (verifyCommands: string[]): StepCommand => ({
    id: "step-verify",
    stepId: "run-tests",
    type: "test",
    promptTemplate: "prompt",
    attempt: 1,
    iteration: 0,
    signals: [],
    verifyCommands,
  });

  test("surfaces a descriptive error when the step's execution host binding is stale", async () => {
    const stepCommand: StepCommand = {
      ...makeStepCommand(["printf verification-ok"]),
      agent: {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "high",
        execHostId: "ehost_missing",
      },
    };

    await expect(
      applyVerificationCommands({
        ctx,
        executorCtx: makeExecutorContext(),
        executionId: "exec-verify",
        stepId: "step-verify",
        stepCommand,
        result: makeSuccessfulResult(),
      }),
    ).rejects.toThrow(/not configured/);
  });

  const makeSuccessfulResult = (): ExecuteResult => ({
    exitCode: 0,
    status: "success",
    assistantOutput: "agent done",
  });
});
