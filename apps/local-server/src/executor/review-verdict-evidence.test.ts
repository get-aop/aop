import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { StepCommand } from "@aop/common/protocol";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { recordReviewVerdictEvidence } from "./review-verdict-evidence.ts";
import type { ExecuteResult, ExecutorContext } from "./types.ts";

describe("recordReviewVerdictEvidence", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo-review", "/tmp/repo-review");
    await createTestTask(db, "task-review", "repo-review", "changes/task-review", "WORKING");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("records passed review verdict evidence for checker output", async () => {
    await recordReviewVerdictEvidence({
      ctx,
      executorCtx: makeExecutorContext(),
      executionId: "exec-review",
      stepId: "step-review",
      stepCommand: makeCheckerCommand(),
      result: {
        exitCode: 0,
        status: "success",
        signal: "REVIEW_PASSED",
        assistantOutput: "The change is correct.\nREVIEW_PASSED",
      },
    });

    const events = await ctx.runtimeEventRepository.listByTaskId("task-review");
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "verification_evidence_recorded",
        status: "passed",
        metadata: expect.objectContaining({
          evidence: expect.objectContaining({
            kind: "review_verdict",
            status: "passed",
            summary: "Review verdict passed: REVIEW_PASSED",
          }),
        }),
      }),
    );
  });

  test("ignores non-review output", async () => {
    await recordReviewVerdictEvidence({
      ctx,
      executorCtx: makeExecutorContext(),
      executionId: "exec-review",
      stepId: "step-review",
      stepCommand: { ...makeCheckerCommand(), checkerStep: false, type: "implement" },
      result: makeSuccessfulResult("TASK_COMPLETE"),
    });

    expect(await ctx.runtimeEventRepository.listByTaskId("task-review")).toEqual([]);
  });
});

const makeCheckerCommand = (): StepCommand => ({
  id: "step-review",
  stepId: "review",
  type: "review",
  promptTemplate: "prompt",
  attempt: 1,
  iteration: 0,
  checkerStep: true,
});

const makeSuccessfulResult = (assistantOutput: string): ExecuteResult => ({
  exitCode: 0,
  status: "success",
  assistantOutput,
});

const makeExecutorContext = (): ExecutorContext => ({
  task: {
    id: "task-review",
    repo_id: "repo-review",
    change_path: "changes/task-review",
    branch_name: null,
    worktree_path: null,
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
  repoId: "repo-review",
  repoPath: "/tmp/repo-review",
  changePath: "/tmp/repo-review/changes/task-review",
  worktreePath: "/tmp/repo-review-worktree",
  logsDir: "/tmp/repo-review-logs",
  timeoutSecs: 30,
  fastMode: false,
});
