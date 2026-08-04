import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import {
  CodexCliProvider,
  type LLMProvider,
  type RunOptions,
  type RunResult,
} from "@aop/llm-provider";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { StepExecutionStatus } from "./execution-types.ts";
import {
  type HandleAgentCompletionFn,
  pollForProcessExit,
  REAPER_POLL_INTERVAL_MS,
  readRunResultFromLog,
  reattachToRunningAgent,
  spawnAgentWithReaper,
} from "./step-launcher.ts";
import type { ExecutorContext, StepWithTask } from "./types.ts";

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  repo_id: "repo-1",
  change_path: "changes/feat-1",
  branch_name: null,
  status: "WORKING",
  worktree_path: null,
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
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const createMockProvider = (
  result: RunResult = { exitCode: 0 },
  onRunCalled?: (opts: RunOptions) => void,
  name = "mock-provider",
): LLMProvider => ({
  name,
  run: async (opts: RunOptions) => {
    onRunCalled?.(opts);
    return result;
  },
});

describe("step-launcher", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;
  let testLogsDir: string;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    testLogsDir = join(tmpdir(), `aop-test-launcher-${Date.now()}`);
    mkdirSync(testLogsDir, { recursive: true });
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
    if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
  });

  describe("spawnAgentWithReaper", () => {
    test("throws when task not found", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      // Don't create the task — it should throw

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      };

      const mockProvider = createMockProvider();

      await expect(
        spawnAgentWithReaper(
          {
            ctx,
            executorCtx,
            worktreeInfo: {
              path: "/test/worktree",
              branch: "task-1",
              baseBranch: "main",
              baseCommit: "abc",
            },
            prompt: "test prompt",
            stepId: "step-1",
            executionId: "exec-1",
            stepCommand: {
              id: "step-1",
              type: "implement",
              promptTemplate: "",
              signals: [],
              attempt: 1,
              iteration: 1,
            },
            executionInfo: { id: "exec-1", workflowId: "wf-1" },
            taskId: "task-nonexistent",
            repoId: "repo-1",
            provider: mockProvider,
          },
          mock(() => Promise.resolve()),
        ),
      ).rejects.toThrow("Task task-nonexistent not found");
    });

    test("calls provider.run and onCompletion with correct args", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      // Create execution + step records for updateStepExecution in onSpawn
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      let capturedOpts: RunOptions | undefined;
      const mockProvider = createMockProvider({ exitCode: 0, sessionId: "sess-1" }, (opts) => {
        capturedOpts = opts;
      });

      const onCompletion = mock(() => Promise.resolve());

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: true,
      };

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx,
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "implement the feature",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "implement",
            promptTemplate: "",
            signals: [{ name: "DONE", description: "done" }],
            attempt: 1,
            iteration: 1,
            isolation: "open",
            resumeSessionId: "runtime-session-1",
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
          signals: [{ name: "DONE", description: "done" }],
          provider: mockProvider,
        },
        onCompletion,
      );

      expect(capturedOpts?.prompt).toBe("implement the feature");
      expect(capturedOpts?.fastMode).toBe(true);
      expect(capturedOpts?.isolation).toBe("open");
      expect(capturedOpts?.disallowedTools).toEqual(["Skill"]);
      expect(capturedOpts?.env).toEqual({ AOP_TASK_ID: "task-1", AOP_STEP_ID: "step-1" });
      expect(capturedOpts?.resumeSessionId).toBe("runtime-session-1");
      expect(capturedOpts?.execHost).toBeUndefined();
      expect(onCompletion).toHaveBeenCalledTimes(1);
    });

    test("fails the step with a descriptive error when execHostId is missing", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-remote", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-remote",
        task_id: "task-remote",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-remote",
        execution_id: "exec-remote",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockProvider = createMockProvider();
      const executorCtx: ExecutorContext = {
        task: createMockTask({ id: "task-remote" }),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      };

      await expect(
        spawnAgentWithReaper(
          {
            ctx,
            executorCtx,
            worktreeInfo: {
              path: "/test/worktree",
              branch: "task-remote",
              baseBranch: "main",
              baseCommit: "abc",
            },
            prompt: "remote work",
            stepId: "step-remote",
            executionId: "exec-remote",
            stepCommand: {
              id: "step-remote",
              type: "implement",
              promptTemplate: "",
              attempt: 1,
              iteration: 1,
              agent: {
                provider: "codex-cli",
                model: "gpt-5.5",
                reasoning: "high",
                execHostId: "ehost_missing",
              },
            },
            executionInfo: { id: "exec-remote", workflowId: "wf-1" },
            taskId: "task-remote",
            repoId: "repo-1",
            provider: mockProvider,
          },
          mock(() => Promise.resolve()),
        ),
      ).rejects.toThrow(/not configured|Execution host/i);
    });

    test("keeps the assigned Pi runtime even when the workflow step declares another agent provider", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-pi", "repo-1", "changes/feat-pi", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-pi",
        task_id: "task-pi",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-pi",
        execution_id: "exec-pi",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      let called = false;
      const piProvider = createMockProvider(
        { exitCode: 0, sessionId: "pi-session-1" },
        () => {
          called = true;
        },
        "pi",
      );

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx: {
            task: createMockTask({ id: "task-pi", change_path: "changes/feat-pi" }),
            repoId: "repo-1",
            repoPath: "/test/repo",
            changePath: "/test/repo/changes/feat-pi",
            worktreePath: "/test/worktree",
            logsDir: testLogsDir,
            timeoutSecs: 300,
            fastMode: false,
          },
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-pi",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "implement with pi",
          stepId: "step-pi",
          executionId: "exec-pi",
          stepCommand: {
            id: "step-pi",
            type: "implement",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "codex-cli",
              model: "gpt-5.5",
              reasoning: "high",
            },
          },
          executionInfo: { id: "exec-pi", workflowId: "wf-1" },
          taskId: "task-pi",
          repoId: "repo-1",
          provider: piProvider,
        },
        mock(() => Promise.resolve()),
      );

      expect(called).toBe(true);
    });

    test("does not read runtime settings from the assigned worker profile", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-codex", "repo-1", "changes/feat-codex", "WORKING");
      await db
        .insertInto("agents")
        .values({
          id: "agent-codex",
          name: "Codex K1",
          role: "developer",
          runtime_provider: "codex-cli",
          provider: "codex-cli",
          model: "gpt-5.5",
          workflow_id: "wf-1",
          status: "active",
          artifact_path: aopPaths.agent("agent-codex"),
          source_kind: "codex-cli-worker-profile",
          source_ref: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();
      await db
        .insertInto("agent_repo_memberships")
        .values({
          agent_id: "agent-codex",
          repo_id: "repo-1",
          membership_role: "primary",
          created_at: new Date().toISOString(),
        })
        .execute();
      mkdirSync(aopPaths.agentRuntime("agent-codex", "codex-cli"), { recursive: true });
      writeFileSync(
        join(aopPaths.agentRuntime("agent-codex", "codex-cli"), "settings.json"),
        JSON.stringify({ model: "gpt-5.5", reasoningEffort: "low", fastMode: true }),
      );
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-codex",
        agentId: "agent-codex",
        repoId: "repo-1",
        statusColumn: "READY",
      });
      await ctx.executionRepository.createExecution({
        id: "exec-codex",
        task_id: "task-codex",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-codex",
        execution_id: "exec-codex",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 5050,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx: {
            task: createMockTask({ id: "task-codex", change_path: "changes/feat-codex" }),
            repoId: "repo-1",
            repoPath: "/test/repo",
            changePath: "/test/repo/changes/feat-codex",
            worktreePath: "/test/worktree",
            logsDir: testLogsDir,
            timeoutSecs: 300,
            fastMode: false,
          },
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-codex",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "implement with codex",
          stepId: "step-codex",
          executionId: "exec-codex",
          stepCommand: {
            id: "step-codex",
            type: "implement",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "codex-cli",
              model: "gpt-5.5",
              reasoning: "medium",
            },
          },
          executionInfo: { id: "exec-codex", workflowId: "wf-1" },
          taskId: "task-codex",
          repoId: "repo-1",
          provider: new CodexCliProvider(),
        },
        mock(() => Promise.resolve()),
      );

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as unknown as { cmd: string[] };
      expect(spawnArgs.cmd).toContain("--model");
      expect(spawnArgs.cmd).toContain("gpt-5.5");
      expect(spawnArgs.cmd).toContain('model_reasoning_effort="medium"');
      expect(spawnArgs.cmd).not.toContain('model_reasoning_effort="low"');
      expect(spawnArgs.cmd).not.toContain("--enable");
      expect(spawnArgs.cmd).not.toContain("fast_mode");
      spawnSpy.mockRestore();
    });

    test("uses workflow step runtime when an assigned worker step declares one", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-step-runtime", "repo-1", "changes/feat-runtime", "WORKING");
      await db
        .insertInto("agents")
        .values({
          id: "agent-codex",
          name: "Codex K1",
          role: "developer",
          runtime_provider: "codex-cli",
          provider: "codex-cli",
          model: "gpt-5.5",
          workflow_id: "wf-1",
          status: "active",
          artifact_path: aopPaths.agent("agent-codex"),
          source_kind: "codex-cli-worker-profile",
          source_ref: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();
      mkdirSync(aopPaths.agentRuntime("agent-codex", "codex-cli"), { recursive: true });
      writeFileSync(
        join(aopPaths.agentRuntime("agent-codex", "codex-cli"), "settings.json"),
        JSON.stringify({ model: "gpt-5.4", reasoningEffort: "low", fastMode: false }),
      );
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: "task-step-runtime",
        agentId: "agent-codex",
        repoId: "repo-1",
        statusColumn: "READY",
      });
      await ctx.executionRepository.createExecution({
        id: "exec-step-runtime",
        task_id: "task-step-runtime",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-runtime",
        execution_id: "exec-step-runtime",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 5151,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx: {
            task: createMockTask({
              id: "task-step-runtime",
              change_path: "changes/feat-runtime",
            }),
            repoId: "repo-1",
            repoPath: "/test/repo",
            changePath: "/test/repo/changes/feat-runtime",
            worktreePath: "/test/worktree",
            logsDir: testLogsDir,
            timeoutSecs: 300,
            fastMode: false,
          },
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-step-runtime",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "review with pi",
          stepId: "step-runtime",
          executionId: "exec-step-runtime",
          stepCommand: {
            id: "step-runtime",
            type: "review",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "pi",
              model: "default",
              reasoning: "high",
              fastMode: false,
            },
          },
          executionInfo: { id: "exec-step-runtime", workflowId: "wf-1" },
          taskId: "task-step-runtime",
          repoId: "repo-1",
        },
        mock(() => Promise.resolve()),
      );

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as unknown as { cmd: string[] };
      expect(spawnArgs.cmd[0]).toBe("pi");
      expect(spawnArgs.cmd).not.toContain("--model");
      expect(spawnArgs.cmd).not.toContain("default");
      expect(spawnArgs.cmd).toContain("--thinking");
      expect(spawnArgs.cmd).toContain("high");
      expect(spawnArgs.cmd).not.toContain("gpt-5.4");
      spawnSpy.mockRestore();
    });

    test("persists resumed Pi session ids on the running step before completion", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-pi", "repo-1", "changes/feat-pi", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-pi",
        task_id: "task-pi",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-pi",
        execution_id: "exec-pi",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx: {
            task: createMockTask({ id: "task-pi", change_path: "changes/feat-pi" }),
            repoId: "repo-1",
            repoPath: "/test/repo",
            changePath: "/test/repo/changes/feat-pi",
            worktreePath: "/test/worktree",
            logsDir: testLogsDir,
            timeoutSecs: 300,
            fastMode: false,
          },
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-pi",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "continue with pi",
          stepId: "step-pi",
          executionId: "exec-pi",
          stepCommand: {
            id: "step-pi",
            type: "implement",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            resumeSessionId: "pi-session-resume-1",
          },
          executionInfo: { id: "exec-pi", workflowId: "wf-1" },
          taskId: "task-pi",
          repoId: "repo-1",
          provider: createMockProvider({ exitCode: 0 }, undefined, "pi"),
        },
        mock(() => Promise.resolve()),
      );

      expect((await ctx.executionRepository.getStepExecution("step-pi"))?.session_id).toBe(
        "pi-session-resume-1",
      );
    });

    test("waits for the spawned process to exit before completing when provider.run resolves early", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      let sleeperPid: number | null = null;
      const fastResolvingProvider: LLMProvider = {
        name: "mock-provider",
        run: async (opts: RunOptions) => {
          const sleeper = Bun.spawn(["/bin/sh", "-c", "sleep 5"]);
          sleeperPid = sleeper.pid;
          await opts.onSpawn?.(sleeper.pid);
          return { exitCode: 0, sessionId: "sess-1" };
        },
      };

      const onCompletion = mock(() => Promise.resolve());

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      };

      const launchPromise = spawnAgentWithReaper(
        {
          ctx,
          executorCtx,
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "implement the feature",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "implement",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
          provider: fastResolvingProvider,
        },
        onCompletion,
      );

      await Bun.sleep(100);
      expect(onCompletion).not.toHaveBeenCalled();

      if (sleeperPid) {
        process.kill(sleeperPid);
      }
      await launchPromise;

      expect(onCompletion).toHaveBeenCalledTimes(1);
    });

    test("uses the step agent config instead of the fallback provider", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      let fallbackUsed = false;
      const fallbackProvider = createMockProvider({ exitCode: 0 }, () => {
        fallbackUsed = true;
      });

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 2147483002,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);

      const onCompletion = mock(() => Promise.resolve());

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      };

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx,
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "review the feature",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "review",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "codex-cli",
              model: "gpt-5.5",
              reasoning: "medium",
            },
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
          provider: fallbackProvider,
        },
        onCompletion,
      );

      expect(fallbackUsed).toBe(false);
      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as unknown as { cmd: string[] };
      expect(spawnArgs.cmd).toEqual([
        "codex",
        "exec",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "--model",
        "gpt-5.5",
        "-c",
        'model_reasoning_effort="medium"',
        "review the feature",
      ]);

      spawnSpy.mockRestore();
    });

    test("uses the OpenCode step agent config when requested", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      let fallbackUsed = false;
      const fallbackProvider = createMockProvider({ exitCode: 0 }, () => {
        fallbackUsed = true;
      });

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 2147483003,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);

      const onCompletion = mock(() => Promise.resolve());

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      };

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx,
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "implement with opencode",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "implement",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "opencode",
              model: "openai/gpt-5.5",
              reasoning: "high",
              fastMode: false,
            },
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
          provider: fallbackProvider,
        },
        onCompletion,
      );

      expect(fallbackUsed).toBe(false);
      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as unknown as { cmd: string[] };
      expect(spawnArgs.cmd).toEqual([
        "opencode",
        "run",
        "--model",
        "openai/gpt-5.5",
        "--format",
        "json",
        "--dangerously-skip-permissions",
        "--variant",
        "high",
        "implement with opencode",
      ]);

      spawnSpy.mockRestore();
    });

    test("resolves a saved runtime configuration immediately before workflow execution", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await db
        .insertInto("runtime_configuration_providers")
        .values({
          id: "rtprov_work_codex",
          name: "Work Codex",
          command: "codex-work",
          driver: "codex-cli",
          built_in: false,
        })
        .execute();
      await db
        .insertInto("runtime_configuration_models")
        .values({
          id: "rtmodel_work_codex",
          provider_id: "rtprov_work_codex",
          description: "Work GPT",
          model: "work/gpt-5.6",
          thinking_levels: JSON.stringify(["high"]),
          fast_mode: false,
          built_in: false,
        })
        .execute();

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 2147483004,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx: {
            task: createMockTask(),
            repoId: "repo-1",
            repoPath: "/test/repo",
            changePath: "/test/repo/changes/feat-1",
            worktreePath: "/test/worktree",
            logsDir: testLogsDir,
            timeoutSecs: 300,
            fastMode: false,
          },
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "use current config",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "implement",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "codex-cli",
              runtimeConfigurationId: "rtprov_work_codex",
              runtimeAlias: "stale-codex",
              model: "gpt-5.5",
              reasoning: "medium",
            },
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
        },
        mock(() => Promise.resolve()),
      );

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as unknown as { cmd: string[] };
      spawnSpy.mockRestore();
      expect(spawnArgs.cmd[0]).toBe("codex-work");
      expect(spawnArgs.cmd).toContain("work/gpt-5.6");
      expect(spawnArgs.cmd).toContain('model_reasoning_effort="high"');
    });

    test("uses the Pi step agent config when requested", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 707070,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);

      const onCompletion = mock(() => Promise.resolve());

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      };

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx,
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "review the feature",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "review",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "pi",
              model: "default",
              reasoning: "extra-high",
            },
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
        },
        onCompletion,
      );

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as unknown as { cmd: string[] };
      spawnSpy.mockRestore();
      expect(spawnArgs.cmd.slice(0, 6)).toEqual([
        "pi",
        "--mode",
        "json",
        "--print",
        "--thinking",
        "xhigh",
      ]);
      expect(spawnArgs.cmd).toContain("--extension");
      expect(spawnArgs.cmd.at(-1)).toBe("review the feature");
    });

    test("passes workflow step Ultracode into Claude Code settings", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 2147483001,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx: {
            task: createMockTask(),
            repoId: "repo-1",
            repoPath: "/test/repo",
            changePath: "/test/repo/changes/feat-1",
            worktreePath: "/test/worktree",
            logsDir: testLogsDir,
            timeoutSecs: 300,
            fastMode: false,
          },
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "implement in ultracode",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "implement",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "claude-code",
              model: "claude-opus-4-8",
              reasoning: "extra-high",
              ultracode: true,
              browserControl: true,
            },
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
        },
        mock(() => Promise.resolve()),
      );

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as unknown as { cmd: string[] };
      expect(spawnArgs.cmd).toContain("--settings");
      expect(spawnArgs.cmd).toContain('{"ultracode":true}');
      expect(spawnArgs.cmd).toContain("--effort");
      expect(spawnArgs.cmd).toContain("xhigh");
      expect(spawnArgs.cmd).toContain("--chrome");
      expect(spawnArgs.cmd.some((part) => part.includes("@playwright/mcp@0.0.78"))).toBe(true);

      spawnSpy.mockRestore();
    });

    test.each([
      { providerName: "e2e-fixture", description: "e2e fixture" },
      { providerName: "pi", description: "Pi runtime" },
    ])("keeps the $description provider even when the workflow step pins a live agent", async ({
      providerName,
    }) => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      let explicitProviderUsed = false;
      const explicitProvider: LLMProvider = createMockProvider(
        { exitCode: 0 },
        () => {
          explicitProviderUsed = true;
        },
        providerName,
      );

      const spawnSpy = spyOn(Bun, "spawn");
      const onCompletion = mock(() => Promise.resolve());

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      };

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx,
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "run the deterministic fixture",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "review",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "codex-cli",
              model: "gpt-5.4",
              reasoning: "medium",
            },
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
          provider: explicitProvider,
        },
        onCompletion,
      );

      expect(explicitProviderUsed).toBe(true);
      expect(spawnSpy).not.toHaveBeenCalled();

      spawnSpy.mockRestore();
    });

    test("uses step-level fastMode when global fastMode is off", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 4242,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);
      const onCompletion = mock(() => Promise.resolve());

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      };

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx,
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "implement the feature",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "implement",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "codex-cli",
              model: "gpt-5.5",
              reasoning: "medium",
              fastMode: true,
            },
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
        },
        onCompletion,
      );

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as unknown as { cmd: string[] };
      expect(spawnArgs.cmd).toContain("--enable");
      expect(spawnArgs.cmd).toContain("fast_mode");
      spawnSpy.mockRestore();
    });

    test("step-level fastMode false disables global fastMode for that step", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
        pid: 4242,
        exited: Promise.resolve(0),
        kill: mock(() => {}),
        unref: mock(() => {}),
      } as unknown as ReturnType<typeof Bun.spawn>);
      const onCompletion = mock(() => Promise.resolve());

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: true,
      };

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx,
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "implement the feature",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "implement",
            promptTemplate: "",
            signals: [],
            attempt: 1,
            iteration: 1,
            agent: {
              provider: "codex-cli",
              model: "gpt-5.5",
              reasoning: "medium",
              fastMode: false,
            },
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
        },
        onCompletion,
      );

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as unknown as { cmd: string[] };
      expect(spawnArgs.cmd).not.toContain("--enable");
      expect(spawnArgs.cmd).not.toContain("fast_mode");
      spawnSpy.mockRestore();
    });
  });

  describe("reattachToRunningAgent", () => {
    test("reattaches and calls onCompletion for completed process", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      // Write a success log file
      const logFile = join(testLogsDir, "step-1.jsonl");
      writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success" }));

      const step: StepWithTask = {
        id: "step-1",
        execution_id: "exec-1",
        step_id: "wf-step-1",
        step_type: "implement",
        agent_pid: null,
        session_id: null,
        status: "running",
        exit_code: null,
        signal: null,
        pause_context: null,
        error: null,
        attempt: 1,
        iteration: 2,
        signals_json: JSON.stringify([{ name: "DONE", description: "done" }]),
        started_at: new Date().toISOString(),
        ended_at: null,
        task_id: "task-1",
      };

      const buildContextFn = mock(async (_ctx: LocalServerContext, task: Task) => ({
        task,
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      }));

      const createWorktreeFn = mock(async () => ({
        path: "/test/worktree",
        branch: "task-1",
        baseBranch: "main",
        baseCommit: "abc",
      }));

      const onCompletion: HandleAgentCompletionFn = mock(() => Promise.resolve());

      await reattachToRunningAgent(ctx, step, buildContextFn, createWorktreeFn, onCompletion);

      expect(buildContextFn).toHaveBeenCalledTimes(1);
      expect(createWorktreeFn).toHaveBeenCalledTimes(1);
      expect(onCompletion).toHaveBeenCalledTimes(1);

      // biome-ignore lint/suspicious/noExplicitAny: test assertion on mock call args
      const [opts, logFilePath, runResult, signals] = (onCompletion as any).mock.calls[0];
      expect(opts.taskId).toBe("task-1");
      expect(opts.stepId).toBe("step-1");
      expect(opts.executionId).toBe("exec-1");
      expect(opts.stepCommand.type).toBe("implement");
      expect(opts.stepCommand.stepId).toBe("wf-step-1");
      expect(opts.stepCommand.attempt).toBe(1);
      expect(opts.stepCommand.iteration).toBe(2);
      expect(opts.executionInfo.id).toBe("exec-1");
      expect(logFilePath).toBe(logFile);
      expect(runResult.exitCode).toBe(0);
      expect(signals).toEqual([{ name: "DONE", description: "done" }]);
    });

    test("throws when task not found", async () => {
      const step: StepWithTask = {
        id: "step-1",
        execution_id: "exec-1",
        step_id: null,
        step_type: null,
        agent_pid: null,
        session_id: null,
        status: "running",
        exit_code: null,
        signal: null,
        pause_context: null,
        error: null,
        attempt: null,
        iteration: null,
        signals_json: null,
        started_at: new Date().toISOString(),
        ended_at: null,
        task_id: "task-nonexistent",
      };

      await expect(
        reattachToRunningAgent(
          ctx,
          step,
          mock(() => Promise.resolve({} as ExecutorContext)),
          mock(() => Promise.resolve({ path: "", branch: "", baseBranch: "", baseCommit: "" })),
          mock(() => Promise.resolve()),
        ),
      ).rejects.toThrow("Task not found: task-nonexistent");
    });

    test("handles step with null signals_json", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const logFile = join(testLogsDir, "step-2.jsonl");
      writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success" }));

      const step: StepWithTask = {
        id: "step-2",
        execution_id: "exec-1",
        step_id: null,
        step_type: null,
        agent_pid: null,
        session_id: null,
        status: "running",
        exit_code: null,
        signal: null,
        pause_context: null,
        error: null,
        attempt: null,
        iteration: null,
        signals_json: null,
        started_at: new Date().toISOString(),
        ended_at: null,
        task_id: "task-1",
      };

      const onCompletion: HandleAgentCompletionFn = mock(() => Promise.resolve());

      await reattachToRunningAgent(
        ctx,
        step,
        mock(async (_ctx: LocalServerContext, task: Task) => ({
          task,
          repoId: "repo-1",
          repoPath: "/test/repo",
          changePath: "/test/repo/changes/feat-1",
          worktreePath: "/test/worktree",
          logsDir: testLogsDir,
          timeoutSecs: 300,
          fastMode: false,
        })),
        mock(async () => ({
          path: "/test/worktree",
          branch: "task-1",
          baseBranch: "main",
          baseCommit: "abc",
        })),
        onCompletion,
      );

      // biome-ignore lint/suspicious/noExplicitAny: test assertion on mock call args
      const [opts, , , signals] = (onCompletion as any).mock.calls[0];
      expect(opts.stepCommand.type).toBe("unknown");
      expect(opts.stepCommand.attempt).toBe(1);
      expect(opts.stepCommand.iteration).toBe(1);
      expect(signals).toEqual([]);
    });
  });

  describe("pollForProcessExit", () => {
    test("resolves immediately for non-existent PID", async () => {
      const start = Date.now();
      await pollForProcessExit(999999999);
      expect(Date.now() - start).toBeLessThan(REAPER_POLL_INTERVAL_MS);
    });
  });

  describe("readRunResultFromLog", () => {
    test("returns exitCode 1 when log file does not exist", () => {
      const result = readRunResultFromLog("/nonexistent/path.jsonl");
      expect(result.exitCode).toBe(1);
    });

    test("returns exitCode 0 when last result is success", () => {
      const logFile = join(testLogsDir, "success.jsonl");
      writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success" }));
      const result = readRunResultFromLog(logFile);
      expect(result.exitCode).toBe(0);
    });

    test("returns a Pi session id from the log for recovery metadata", () => {
      const logFile = join(testLogsDir, "pi-session.jsonl");
      writeFileSync(
        logFile,
        [
          JSON.stringify({ type: "system", session_id: "pi-session-1" }),
          JSON.stringify({ type: "result", subtype: "success" }),
        ].join("\n"),
      );
      const result = readRunResultFromLog(logFile);
      expect(result).toEqual({ exitCode: 0, sessionId: "pi-session-1" });
    });

    test("returns exitCode 1 when last result is failure", () => {
      const logFile = join(testLogsDir, "failure.jsonl");
      writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "error" }));
      const result = readRunResultFromLog(logFile);
      expect(result.exitCode).toBe(1);
    });

    test("returns exitCode 0 when result entry is multi-line JSON", () => {
      const logFile = join(testLogsDir, "multiline-result.jsonl");
      writeFileSync(
        logFile,
        '{\n  "type": "result",\n  "subtype": "success",\n  "result": "done"\n}\n',
      );
      const result = readRunResultFromLog(logFile);
      expect(result.exitCode).toBe(0);
    });

    test("returns exitCode 0 for OpenCode-style streams without result entry", () => {
      const logFile = join(testLogsDir, "opencode-success.jsonl");
      writeFileSync(
        logFile,
        [
          JSON.stringify({ type: "tool_use", part: { tool: "bash", state: { input: {} } } }),
          JSON.stringify({
            type: "text",
            part: { text: "All tasks complete <aop>ALL_TASKS_DONE</aop>" },
          }),
        ].join("\n"),
      );
      const result = readRunResultFromLog(logFile);
      expect(result.exitCode).toBe(0);
    });

    test("returns exitCode 1 when stream contains explicit error marker", () => {
      const logFile = join(testLogsDir, "opencode-failure.jsonl");
      writeFileSync(
        logFile,
        [
          JSON.stringify({ type: "tool_use", part: { tool: "bash", state: { input: {} } } }),
          JSON.stringify({ type: "event", level: "error", error: "tool failed" }),
        ].join("\n"),
      );
      const result = readRunResultFromLog(logFile);
      expect(result.exitCode).toBe(1);
    });

    test("returns exitCode 1 when trailing JSON line is partial", () => {
      const logFile = join(testLogsDir, "partial-tail.jsonl");
      writeFileSync(
        logFile,
        [
          JSON.stringify({ type: "text", part: { text: "Done <aop>ALL_TASKS_DONE</aop>" } }),
          '{"type":"result","subtype":"success"',
        ].join("\n"),
      );

      const result = readRunResultFromLog(logFile);
      expect(result.exitCode).toBe(1);
    });

    test("recovers a canonical result from openclaw raw log files", () => {
      const logFile = join(testLogsDir, "openclaw-recovery.jsonl");
      writeFileSync(`${logFile}.openclaw.stdout`, "Recovered <aop>ALL_TASKS_DONE</aop>");
      writeFileSync(`${logFile}.openclaw.stderr`, "");

      const result = readRunResultFromLog(logFile);

      expect(result.exitCode).toBe(0);
      expect(readFileSync(logFile, "utf-8")).toContain('"provider":"openclaw"');
      expect(readFileSync(logFile, "utf-8")).toContain("ALL_TASKS_DONE");
    });
  });
});
