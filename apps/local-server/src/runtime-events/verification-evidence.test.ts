import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { recordVerificationEvidence } from "./verification-evidence.ts";

describe("recordVerificationEvidence", () => {
  let cleanupAopHome: () => void;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/runtime-evidence-repo");
    await createTestTask(db, "task-1", "repo-1", "changes/task-1", "WORKING");
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: "running",
      started_at: "2026-06-24T12:00:00.000Z",
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      step_id: "run-tests",
      step_type: "test",
      status: "success",
      started_at: "2026-06-24T12:00:00.000Z",
    });
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("records verification evidence as a canonical runtime event", async () => {
    await recordVerificationEvidence(ctx, {
      taskId: "task-1",
      executionId: "exec-1",
      stepExecutionId: "step-1",
      evidence: {
        kind: "test_command",
        command: "bun test apps/local-server/src/workflow/service.test.ts",
        status: "passed",
        exitCode: 0,
        startedAt: "2026-06-24T12:00:01.000Z",
        endedAt: "2026-06-24T12:00:05.000Z",
        summary: "18 tests passed",
        artifactPath: "~/.aop/logs/step-1.jsonl",
      },
    });

    const events = await ctx.runtimeEventRepository.listByTaskId("task-1");
    expect(events).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        executionId: "exec-1",
        stepExecutionId: "step-1",
        kind: "verification_evidence_recorded",
        title: "Verification passed",
        message: "18 tests passed",
        status: "passed",
        metadata: {
          evidence: {
            kind: "test_command",
            command: "bun test apps/local-server/src/workflow/service.test.ts",
            status: "passed",
            exitCode: 0,
            startedAt: "2026-06-24T12:00:01.000Z",
            endedAt: "2026-06-24T12:00:05.000Z",
            summary: "18 tests passed",
            artifactPath: "~/.aop/logs/step-1.jsonl",
          },
        },
      }),
    ]);

    const summary = await ctx.runtimeEventRepository.getActivitySummary("task-1");
    expect(summary?.verificationEvidenceRecorded).toBe(true);
    expect(summary?.latestMessage).toBe("18 tests passed");
  });
});
