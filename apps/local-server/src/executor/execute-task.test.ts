import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { executeTask, handleAgentCompletion } from "./executor.ts";

const originalFetch = globalThis.fetch;
const originalWorkerMemoryProvider = process.env.AOP_WORKER_MEMORY_PROVIDER;
const originalAgentMemoryUrl = process.env.AOP_AGENTMEMORY_URL;

describe("executeTask", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let testRepoPath: string;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);

    testRepoPath = join(tmpdir(), `aop-test-repo-exec-${Date.now()}`);
    mkdirSync(testRepoPath, { recursive: true });
    await createTestRepo(db, "repo-1", testRepoPath);
  });

  afterEach(async () => {
    await db.destroy();
    if (existsSync(testRepoPath)) {
      rmSync(testRepoPath, { recursive: true });
    }
    globalThis.fetch = originalFetch;
    restoreEnv("AOP_WORKER_MEMORY_PROVIDER", originalWorkerMemoryProvider);
    restoreEnv("AOP_AGENTMEMORY_URL", originalAgentMemoryUrl);
    cleanupAopHome();
  });

  const createProvider = (exitCode: number) => ({
    name: "mock-provider",
    run: mock(async ({ onSpawn }: { onSpawn?: (pid: number) => Promise<void> }) => {
      await onSpawn?.(4242);
      return { exitCode, sessionId: "mock-session", timedOut: false };
    }),
  });

  const createExecutionState = async (taskId: string, stepId: string) => {
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: taskId,
      workflow_id: "aop-default-gpt",
      status: "running",
      visited_steps: JSON.stringify(["draft_plan"]),
      iteration: 0,
      started_at: new Date().toISOString(),
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId,
      execution_id: "exec-1",
      step_id: "draft_plan",
      step_type: "implement",
      status: "running",
      started_at: new Date().toISOString(),
      signals_json: JSON.stringify([]),
    });
  };

  test("marks the task done when the step completes successfully", async () => {
    await createTestTask(db, "task-exec-1", "repo-1", "changes/feat-1", "READY");
    await createExecutionState("task-exec-1", "step-1");

    ctx.workflowService.completeStep = mock(async (task, input) => {
      await ctx.executionRepository.updateStepExecution(input.stepId, {
        status: "success",
        ended_at: new Date().toISOString(),
      });
      await ctx.executionRepository.updateExecution(input.executionId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
      await ctx.taskRepository.update(task.id, { status: "DONE" });
      return { taskStatus: "DONE" as const, step: null };
    });

    const task = await ctx.taskRepository.get("task-exec-1");
    if (!task) throw new Error("Task should exist");

    const provider = createProvider(0);

    await executeTask(
      ctx,
      task,
      {
        id: "step-1",
        type: "implement",
        promptTemplate: "Implement feature for {{task.id}}",
        signals: [],
        attempt: 1,
        iteration: 0,
      },
      {
        id: "exec-1",
        workflowId: "aop-default-gpt",
      },
      provider as never,
    );

    expect(provider.run).toHaveBeenCalled();
    expect((await ctx.executionRepository.getStepExecution("step-1"))?.session_id).toBe(
      "mock-session",
    );
    expect((await ctx.taskRepository.get("task-exec-1"))?.status).toBe("DONE");
    expect((await ctx.taskRepository.get("task-exec-1"))?.worktree_path).toBeNull();
    expect(Bun.file(aopPaths.worktree("repo-1", "task-exec-1")).exists()).resolves.toBe(false);
    const branchResult = await Bun.$`git branch --list feat-1`.cwd(testRepoPath).text();
    expect(branchResult.trim()).toContain("feat-1");
    expect((await ctx.executionRepository.getExecution("exec-1"))?.status).toBe("completed");
  });

  test("prepends recalled worker memory to the launched step prompt", async () => {
    process.env.AOP_WORKER_MEMORY_PROVIDER = "agentmemory";
    process.env.AOP_AGENTMEMORY_URL = "http://memory.local";
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/agentmemory/session/start")) {
        return jsonResponse({ context: "Project convention: use runtime adapters." });
      }
      if (url.endsWith("/agentmemory/search")) {
        return jsonResponse({ context: "Prior decision: task executions are session-scoped." });
      }
      return jsonResponse({ success: true });
    }) as typeof fetch;

    await createTestTask(db, "task-exec-memory", "repo-1", "changes/feat-memory", "READY");
    await createExecutionState("task-exec-memory", "step-memory");

    ctx.workflowService.completeStep = mock(async (task, input) => {
      await ctx.executionRepository.updateStepExecution(input.stepId, {
        status: "success",
        ended_at: new Date().toISOString(),
      });
      await ctx.executionRepository.updateExecution(input.executionId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
      await ctx.taskRepository.update(task.id, { status: "DONE" });
      return { taskStatus: "DONE" as const, step: null };
    });

    const task = await ctx.taskRepository.get("task-exec-memory");
    if (!task) throw new Error("Task should exist");

    let launchedPrompt = "";

    const provider = {
      name: "mock-provider",
      run: mock(
        async ({
          prompt,
          onSpawn,
        }: {
          prompt: string;
          onSpawn?: (pid: number) => Promise<void>;
        }) => {
          launchedPrompt = prompt;
          await onSpawn?.(4242);
          return { exitCode: 0, sessionId: "mock-session", timedOut: false };
        },
      ),
    };

    await executeTask(
      ctx,
      task,
      {
        id: "step-memory",
        type: "implement",
        promptTemplate: "Implement feature for {{task.id}}",
        signals: [],
        attempt: 1,
        iteration: 0,
      },
      {
        id: "exec-1",
        workflowId: "aop-default-gpt",
      },
      provider as never,
    );

    expect(launchedPrompt).toContain("## Worker Memory Context");
    expect(launchedPrompt).toContain("Project convention: use runtime adapters.");
    expect(launchedPrompt).toContain("Prior decision: task executions are session-scoped.");
    expect(launchedPrompt).toContain("Implement feature for task-exec-memory");
  });

  test("marks the task blocked when the step fails", async () => {
    await createTestTask(db, "task-exec-2", "repo-1", "changes/feat-2", "READY");
    await createExecutionState("task-exec-2", "step-1");

    ctx.workflowService.completeStep = mock(async (task, input) => {
      await ctx.executionRepository.updateStepExecution(input.stepId, {
        status: "failure",
        ended_at: new Date().toISOString(),
      });
      await ctx.executionRepository.updateExecution(input.executionId, {
        status: "failed",
        completed_at: new Date().toISOString(),
      });
      await ctx.taskRepository.update(task.id, { status: "BLOCKED" });
      return {
        taskStatus: "BLOCKED" as const,
        step: null,
        error: {
          code: "max_retries_exceeded" as const,
          message: "Workflow blocked after step failure",
        },
      };
    });

    const task = await ctx.taskRepository.get("task-exec-2");
    if (!task) throw new Error("Task should exist");

    await executeTask(
      ctx,
      task,
      {
        id: "step-1",
        type: "implement",
        promptTemplate: "Implement feature",
        signals: [],
        attempt: 1,
        iteration: 0,
      },
      {
        id: "exec-1",
        workflowId: "aop-default-gpt",
      },
      createProvider(1) as never,
    );

    expect((await ctx.taskRepository.get("task-exec-2"))?.status).toBe("BLOCKED");
    expect((await ctx.executionRepository.getExecution("exec-1"))?.status).toBe("failed");
  });

  test("finalizes completion even when the task doc is already marked DONE", async () => {
    await createTestTask(db, "task-exec-3", "repo-1", "changes/feat-3", "WORKING");
    await createExecutionState("task-exec-3", "step-1");

    await ctx.taskRepository.update("task-exec-3", { status: "DONE" });
    const completeStep = mock(async () => ({ taskStatus: "DONE" as const, step: null }));
    ctx.workflowService.completeStep = completeStep;

    const logFile = join(tmpdir(), `aop-test-handle-completion-${Date.now()}.jsonl`);
    await writeFile(
      logFile,
      JSON.stringify({ type: "text", part: { text: "<aop>ALL_TASKS_DONE</aop>" } }),
    );

    const task = await ctx.taskRepository.get("task-exec-3");
    if (!task) throw new Error("Task should exist");

    await handleAgentCompletion(
      {
        ctx,
        executorCtx: {
          task,
          repoId: "repo-1",
          repoPath: testRepoPath,
          changePath: join(testRepoPath, "changes/feat-3"),
          worktreePath: join(testRepoPath, ".worktree"),
          logsDir: tmpdir(),
          timeoutSecs: 300,
          fastMode: false,
        },
        worktreeInfo: {
          path: join(testRepoPath, ".worktree"),
          branch: "feat-3",
          baseBranch: "main",
          baseCommit: "abc123",
        },
        executionId: "exec-1",
        executionInfo: { id: "exec-1", workflowId: "aop-default-gpt" },
        prompt: "prompt",
        stepId: "step-1",
        stepCommand: {
          id: "step-1",
          type: "implement",
          promptTemplate: "prompt",
          signals: [{ name: "ALL_TASKS_DONE", description: "done" }],
          attempt: 1,
          iteration: 0,
        },
        taskId: "task-exec-3",
        repoId: "repo-1",
      },
      logFile,
      { exitCode: 0, sessionId: "session-1" },
      [{ name: "ALL_TASKS_DONE", description: "done" }],
    );

    expect(completeStep).toHaveBeenCalledTimes(1);
  });

  test("materializes review report from REVIEW_FAILED output before launching fix-issues", async () => {
    await createTestTask(db, "task-review-report", "repo-1", "changes/review-report", "WORKING");
    await createExecutionState("task-review-report", "step-review");

    const docsDir = join(tmpdir(), `aop-review-report-docs-${Date.now()}`);
    mkdirSync(docsDir, { recursive: true });
    const worktreePath = join(testRepoPath, ".worktree-review-report");
    mkdirSync(worktreePath, { recursive: true });

    const logFile = join(tmpdir(), `aop-review-report-${Date.now()}.jsonl`);
    await writeFile(
      logFile,
      `${JSON.stringify({
        type: "text",
        part: {
          text: [
            "Findings:",
            "- apps/example.ts:12 has duplicated orchestration that fix-issues must simplify.",
            "<aop>REVIEW_FAILED</aop>",
          ].join("\n"),
        },
      })}\n`,
    );

    ctx.workflowService.completeStep = mock(async (task, input) => {
      if (input.stepId === "step-review") {
        await ctx.executionRepository.updateStepExecution(input.stepId, {
          status: "success",
          signal: input.signal ?? null,
          ended_at: new Date().toISOString(),
        });
        await ctx.executionRepository.createStepExecution({
          id: "step-fix",
          execution_id: input.executionId,
          step_id: "fix-issues",
          step_type: "implement",
          status: "running",
          started_at: new Date().toISOString(),
          signals_json: JSON.stringify([]),
        });
        return {
          taskStatus: "WORKING" as const,
          execution: { id: input.executionId, workflowId: "aop-default-gpt" },
          step: {
            id: "step-fix",
            stepId: "fix-issues",
            type: "implement",
            promptTemplate: "Fix issues from `{{task.docsDir}}/agent-review-report.md`.",
            signals: [],
            attempt: 1,
            iteration: 0,
          },
        };
      }

      await ctx.executionRepository.updateStepExecution(input.stepId, {
        status: "success",
        ended_at: new Date().toISOString(),
      });
      await ctx.taskRepository.update(task.id, { status: "DONE" });
      return { taskStatus: "DONE" as const, step: null };
    });

    let launchedFixPrompt = "";
    const provider = {
      name: "mock-provider",
      run: mock(
        async ({
          prompt,
          onSpawn,
        }: {
          prompt: string;
          onSpawn?: (pid: number) => Promise<void>;
        }) => {
          launchedFixPrompt = prompt;
          await onSpawn?.(4243);
          return { exitCode: 0, sessionId: "fix-session", timedOut: false };
        },
      ),
    };

    const task = await ctx.taskRepository.get("task-review-report");
    if (!task) throw new Error("Task should exist");

    await handleAgentCompletion(
      {
        ctx,
        executorCtx: {
          task,
          repoId: "repo-1",
          repoPath: testRepoPath,
          changePath: docsDir,
          worktreePath,
          logsDir: tmpdir(),
          timeoutSecs: 300,
          fastMode: false,
        },
        worktreeInfo: {
          path: worktreePath,
          branch: "review-report",
          baseBranch: "main",
          baseCommit: "abc123",
        },
        executionId: "exec-1",
        executionInfo: { id: "exec-1", workflowId: "aop-default-gpt" },
        prompt: "prompt",
        stepId: "step-review",
        stepCommand: {
          id: "step-review",
          stepId: "nuclear_review",
          type: "review",
          promptTemplate: "review",
          signals: [{ name: "REVIEW_FAILED", description: "issues found" }],
          attempt: 1,
          iteration: 0,
        },
        taskId: "task-review-report",
        repoId: "repo-1",
        provider: provider as never,
      },
      logFile,
      { exitCode: 0, sessionId: "review-session" },
      [{ name: "REVIEW_FAILED", description: "issues found" }],
    );

    const report = await readFile(join(docsDir, "agent-review-report.md"), "utf-8");
    expect(report).toContain("Generated from the review step output");
    expect(report).toContain("apps/example.ts:12 has duplicated orchestration");
    expect(launchedFixPrompt).toContain(`${docsDir}/agent-review-report.md`);
  });
});

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};
