import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { imageAttachmentMarker } from "@aop/common";
import type { ExecutionInfo, SignalDefinition, StepCommand } from "@aop/common/protocol";
import type { WorktreeInfo } from "@aop/git-manager";
import { aopPaths, getLogger } from "@aop/infra";
import type { LLMProvider, RunResult } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { NewStepUsage, Task } from "../db/schema.ts";
import { createExecHostsService } from "../exec-hosts/service.ts";
import {
  createTemplateContext,
  resolveTemplate,
  type TaskAttachmentContext,
} from "../orchestrator/sync/template-resolver.ts";
import { loadOutputSignalsSection } from "../prompts/template-loader.ts";
import { SettingKey } from "../settings/types.ts";
import { resolveTaskExecutionContext } from "../task/execution-model.ts";
import { resolveTaskDir } from "../task-docs/paths.ts";
import { createAgentMemoryWorkerMemory } from "../worker-memory/agentmemory.ts";
import {
  cleanupLogFile,
  ensureDir,
  finalizeExecutionAndGetNextStep,
  populateLogBuffer,
  processAgentCompletion,
} from "./completion-handler.ts";
import { buildRemoteWorkspaceContext, syncFromRemote, syncToRemote } from "./remote-workspace.ts";
import { recordReviewVerdictEvidence } from "./review-verdict-evidence.ts";
import type { SpawnAgentOptions } from "./step-launcher.ts";
import { spawnAgentWithReaper } from "./step-launcher.ts";
import type { ExecuteResult, ExecutorContext, StepWithTask } from "./types.ts";
import { applyVerificationCommands } from "./verification-commands.ts";
import { createWorktree } from "./worktree-manager.ts";

// Re-export from sub-modules for backward compatibility
export {
  cleanupLogFile,
  ensureDir,
  extractPauseContext,
  finalizeExecutionAndGetNextStep,
  persistStepLogs,
  populateLogBuffer,
  processAgentCompletion,
} from "./completion-handler.ts";
export {
  pollForProcessExit,
  REAPER_POLL_INTERVAL_MS,
  readRunResultFromLog,
  type SpawnAgentOptions,
} from "./step-launcher.ts";
export { createWorktree } from "./worktree-manager.ts";

export const setupWorktreeOpenspecSymlink = (worktreePath: string, _repoId: string): void => {
  ensureDir(worktreePath);
};

const logger = getLogger("executor");

const REVIEW_FAILED_SIGNAL = "REVIEW_FAILED";
const AGENT_REVIEW_REPORT_FILENAME = "agent-review-report.md";

export interface ExecuteTaskOptions {
  ctx: LocalServerContext;
  task: Task;
  stepCommand: StepCommand;
  executionInfo: ExecutionInfo;
  provider?: LLMProvider;
}

export const executeTask = async (
  ctx: LocalServerContext,
  task: Task,
  stepCommand: StepCommand,
  executionInfo: ExecutionInfo,
  provider?: LLMProvider,
): Promise<void> => {
  const log = logger.with({ taskId: task.id, changePath: task.change_path });
  log.info("Starting task execution");

  const executorCtx = await buildContext(ctx, task);
  await markTaskWorking(ctx, task, executorCtx.worktreePath);

  const worktreeInfo = await createWorktree(executorCtx);
  await ctx.taskRepository.update(task.id, { branch_name: worktreeInfo.branch });
  log.info("Worktree ready at {path}", { path: worktreeInfo.path });

  return launchStep({
    ctx,
    executorCtx,
    worktreeInfo,
    executionId: executionInfo.id,
    stepCommand,
    executionInfo,
    taskId: task.id,
    repoId: task.repo_id,
    provider,
  });
};

export const reattachToRunningAgent = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  provider?: LLMProvider,
): Promise<void> => {
  const { reattachToRunningAgent: reattachFn } = await import("./step-launcher.ts");
  return reattachFn(ctx, step, buildContext, createWorktree, handleAgentCompletion, provider);
};

export const handleAgentCompletion = async (
  opts: SpawnAgentOptions,
  logFile: string,
  runResult: RunResult,
  signals: SignalDefinition[],
): Promise<void> => {
  const {
    ctx,
    executorCtx,
    worktreeInfo,
    executionId,
    stepId,
    stepCommand,
    taskId,
    repoId,
    provider,
  } = opts;

  const result = processAgentCompletion(logFile, runResult, signals);
  if (result.sessionId) {
    await ctx.executionRepository.updateStepExecution(stepId, {
      session_id: result.sessionId,
    });
  }

  const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(taskId);
  await createAgentMemoryWorkerMemory()
    .recordCompletion({
      workerId: assignment?.agent_id ?? null,
      repoId,
      repoPath: executorCtx.repoPath,
      worktreePath: executorCtx.worktreePath,
      taskId,
      executionId,
      stepId,
      changePath: executorCtx.task.change_path,
      stepType: stepCommand.type,
      status: result.status === "success" ? "success" : "failure",
      sessionId: result.sessionId,
    })
    .catch((error) => {
      logger.warn("Worker memory completion recording failed: {error}", {
        taskId,
        stepId,
        error: String(error),
      });
    });

  logger.info("Agent finished step {stepType}", {
    stepType: stepCommand.type,
    exitCode: result.exitCode,
    status: result.status,
    signal: result.signal,
  });

  await maybeSyncFromRemote(ctx, executorCtx, stepCommand, worktreeInfo.branch);

  let completionResult = await materializeReviewFailureReport({
    docsDir: executorCtx.changePath,
    result,
    taskId,
    stepId,
  });

  completionResult = await applyVerificationCommands({
    ctx,
    executorCtx,
    executionId,
    stepId,
    stepCommand,
    result: completionResult,
  });

  await recordReviewVerdictEvidence({
    ctx,
    executorCtx,
    executionId,
    stepId,
    stepCommand,
    result: completionResult,
  });

  await persistStepUsage(ctx, stepId, completionResult);

  await ctx.logFlusher.finalFlush(stepId);

  populateLogBuffer(ctx, logFile, stepId);

  const completionStatus = completionResult.status === "success" ? "completed" : "failed";
  ctx.logBuffer.markComplete(stepId, completionStatus);

  cleanupLogFile(logFile);

  const currentTask = await ctx.taskRepository.get(taskId);
  if (currentTask && currentTask.status !== "WORKING" && currentTask.status !== "DONE") {
    logger.info("Task status changed to {status}, skipping next step", {
      taskId,
      status: currentTask.status,
    });
    return;
  }

  const nextStepInfo = await finalizeExecutionAndGetNextStep(
    ctx,
    taskId,
    executionId,
    stepId,
    completionResult,
  );

  if (!nextStepInfo) return;

  const taskAfterServer = await ctx.taskRepository.get(taskId);
  if (taskAfterServer?.status !== "WORKING") {
    logger.info("Task status changed during server call, skipping next step", {
      taskId,
      status: taskAfterServer?.status,
    });
    return;
  }

  logger.info("Continuing to next step: {stepType}", {
    stepType: nextStepInfo.step.type,
  });
  await launchStep({
    ctx,
    executorCtx,
    worktreeInfo,
    executionId,
    stepCommand: nextStepInfo.step,
    executionInfo: nextStepInfo.execution,
    taskId,
    repoId,
    provider,
  });
};

const materializeReviewFailureReport = async (input: {
  docsDir: string;
  result: ExecuteResult;
  taskId: string;
  stepId: string;
}): Promise<ExecuteResult> => {
  const { docsDir, result, taskId, stepId } = input;
  if (result.status !== "success" || result.signal !== REVIEW_FAILED_SIGNAL) {
    return result;
  }

  const reportPath = join(docsDir, AGENT_REVIEW_REPORT_FILENAME);
  const existingReport = await readOptionalFile(reportPath);
  if (existingReport.trim().length > 0) {
    return result;
  }

  const reviewOutput = stripAopSignals(result.assistantOutput).trim();
  if (reviewOutput.length === 0) {
    logger.warn("Review failed without reportable output; blocking fix-issues handoff", {
      taskId,
      stepId,
      reportPath,
    });
    return {
      ...result,
      exitCode: 1,
      status: "failure",
      signal: undefined,
    };
  }

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, formatGeneratedReviewReport(reviewOutput), "utf-8");
  logger.info("Materialized review failure report from agent output", {
    taskId,
    stepId,
    reportPath,
  });

  return result;
};

const readOptionalFile = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
};

const stripAopSignals = (value: string): string => value.replace(/<aop>[^<]+<\/aop>/g, "");

const formatGeneratedReviewReport = (reviewOutput: string): string =>
  [
    "# Agent Review Report",
    "",
    "Generated from the review step output because no agent-review-report.md was written.",
    "",
    "## Review Output",
    "",
    reviewOutput,
    "",
  ].join("\n");

export const buildContext = async (
  ctx: LocalServerContext,
  task: Task,
  logsDir = aopPaths.logs(),
): Promise<ExecutorContext> => {
  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    throw new Error(`Repo not found: ${task.repo_id}`);
  }

  const executionContext = await resolveTaskExecutionContext(task, repo.path, ctx.repoRepository);

  const timeoutSecs = Number.parseInt(
    await ctx.settingsRepository.get(SettingKey.AGENT_TIMEOUT_SECS),
    10,
  );

  const fastMode = (await ctx.settingsRepository.get(SettingKey.FAST_MODE)) === "true";

  ensureDir(logsDir);

  const changePath = resolveTaskDir(
    executionContext.primaryRepository.repoId,
    executionContext.primaryRepository.repoPath,
    task.change_path,
  );
  const worktreePath = aopPaths.worktree(executionContext.primaryRepository.repoId, task.id);

  return {
    task,
    repoId: executionContext.primaryRepository.repoId,
    repoPath: executionContext.primaryRepository.repoPath,
    changePath,
    worktreePath,
    logsDir,
    timeoutSecs,
    fastMode,
    repositories: executionContext.repositories,
    executionModel: executionContext.model,
  };
};

export const markTaskWorking = async (
  ctx: LocalServerContext,
  task: Task,
  worktreePath: string,
): Promise<void> => {
  await ctx.taskRepository.update(task.id, {
    status: "WORKING",
    worktree_path: worktreePath,
  });
};

export interface BuildPromptOptions {
  executorCtx: ExecutorContext;
  worktreeInfo: WorktreeInfo;
  stepCommand: StepCommand;
  executionId?: string;
}

export const buildPromptForExecution = async (opts: BuildPromptOptions): Promise<string> => {
  const { executorCtx, worktreeInfo, stepCommand, executionId } = opts;

  const templateContext = createTemplateContext({
    worktreePath: worktreeInfo.path,
    worktreeBranch: worktreeInfo.branch,
    taskId: executorCtx.task.id,
    changePath: executorCtx.task.change_path,
    docsDir: executorCtx.changePath,
    attachments: await listTaskAttachments(executorCtx.changePath),
    repositories:
      executorCtx.repositories?.map((repository) => ({
        repoId: repository.repoId,
        assignment: repository.assignment,
        path: repository.repoPath,
        writable: repository.writable,
      })) ?? [],
    stepType: stepCommand.type,
    executionId: executionId ?? "",
    iteration: stepCommand.iteration,
    signals: stepCommand.signals,
    input: stepCommand.input,
  });
  const promptTemplate = await ensureSignalsSection(
    stepCommand.promptTemplate,
    stepCommand.signals,
  );
  return resolveTemplate(promptTemplate, templateContext);
};

const SIGNALS_SECTION_PATTERN = /\{\{\s*#each signals\s*\}\}|\{\{\s*>\s*output-signals\s*\}\}/;

/**
 * Custom step blocks often define signals without pasting the boilerplate that
 * tells the agent how to emit them — append the canonical output-signals
 * section when the template defines signals but lacks one. Templates that
 * already render signals themselves are left untouched.
 */
const ensureSignalsSection = async (
  template: string,
  signals: StepCommand["signals"],
): Promise<string> => {
  if (!signals || signals.length === 0) {
    return template;
  }
  if (SIGNALS_SECTION_PATTERN.test(template)) {
    return template;
  }
  return `${template.trimEnd()}\n\n${await loadOutputSignalsSection()}`;
};

const IMAGE_ATTACHMENT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

/** Surface task images to prompt templates as #imageN in filename order. */
const listTaskAttachments = async (docsDir: string): Promise<TaskAttachmentContext[]> => {
  const attachmentsDir = join(docsDir, "attachments");
  let names: string[];
  try {
    names = await readdir(attachmentsDir);
  } catch {
    return [];
  }

  return names
    .filter((name) => IMAGE_ATTACHMENT_EXTENSIONS.has(name.split(".").pop()?.toLowerCase() ?? ""))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name, index) => ({
      label: imageAttachmentMarker(index + 1),
      path: join(attachmentsDir, name),
    }));
};

interface BuildPromptWithWorkerMemoryOptions {
  ctx: LocalServerContext;
  executorCtx: ExecutorContext;
  basePrompt: string;
  executionId: string;
  stepId: string;
}

const buildPromptWithWorkerMemory = async ({
  ctx,
  executorCtx,
  basePrompt,
  executionId,
  stepId,
}: BuildPromptWithWorkerMemoryOptions): Promise<string> => {
  const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(executorCtx.task.id);
  const memoryContext = await createAgentMemoryWorkerMemory()
    .recall({
      workerId: assignment?.agent_id ?? null,
      repoId: executorCtx.repoId,
      repoPath: executorCtx.repoPath,
      worktreePath: executorCtx.worktreePath,
      taskId: executorCtx.task.id,
      executionId,
      stepId,
      changePath: executorCtx.task.change_path,
      prompt: basePrompt,
    })
    .catch((error) => {
      logger.warn("Worker memory recall failed: {error}", {
        taskId: executorCtx.task.id,
        stepId,
        error: String(error),
      });
      return null;
    });

  return memoryContext ? `${memoryContext}\n\n${basePrompt}` : basePrompt;
};

// --- Private helpers ---

interface LaunchStepOptions {
  ctx: LocalServerContext;
  executorCtx: ExecutorContext;
  worktreeInfo: WorktreeInfo;
  executionId: string;
  stepCommand: StepCommand;
  executionInfo: ExecutionInfo;
  taskId: string;
  repoId: string;
  provider?: LLMProvider;
}

const launchStep = async (opts: LaunchStepOptions): Promise<void> => {
  const {
    ctx,
    executorCtx,
    worktreeInfo,
    executionId,
    stepCommand,
    executionInfo,
    taskId,
    repoId,
    provider,
  } = opts;

  const currentTask = await ctx.taskRepository.get(taskId);
  if (currentTask?.status !== "WORKING") {
    logger.info("Task no longer WORKING before step launch, skipping", {
      taskId,
      status: currentTask?.status,
    });
    return;
  }

  const stepId = stepCommand.id;
  logger.info("Created step record", {
    executionId,
    stepId,
    stepType: stepCommand.type,
  });

  const basePrompt = await buildPromptForExecution({
    executorCtx,
    worktreeInfo,
    stepCommand,
    executionId: executionInfo.id,
  });
  const prompt = await buildPromptWithWorkerMemory({
    ctx,
    executorCtx,
    basePrompt,
    executionId: executionInfo.id,
    stepId,
  });
  logger.info("Prompt rendered for step {stepType}, spawning agent", {
    stepType: stepCommand.type,
  });

  await maybeSyncToRemote(ctx, executorCtx, stepCommand, worktreeInfo.branch);

  return spawnAgentWithReaper(
    {
      ctx,
      executorCtx,
      worktreeInfo,
      prompt,
      stepId,
      executionId,
      stepCommand,
      executionInfo,
      taskId,
      repoId,
      signals: stepCommand.signals,
      provider,
    },
    handleAgentCompletion,
  );
};

const resolveRemoteStep = (
  ctx: LocalServerContext,
  executorCtx: ExecutorContext,
  stepCommand: StepCommand,
) =>
  createExecHostsService(ctx).resolveStepExecHost(stepCommand.agent?.execHostId, {
    worktreePath: executorCtx.worktreePath,
    taskId: executorCtx.task.id,
  });

const maybeSyncToRemote = async (
  ctx: LocalServerContext,
  executorCtx: ExecutorContext,
  stepCommand: StepCommand,
  branch: string,
): Promise<void> => {
  const resolved = await resolveRemoteStep(ctx, executorCtx, stepCommand);
  if (!resolved) return;
  await syncToRemote(buildRemoteWorkspaceContext(resolved.config, executorCtx, branch));
};

const maybeSyncFromRemote = async (
  ctx: LocalServerContext,
  executorCtx: ExecutorContext,
  stepCommand: StepCommand,
  branch: string,
): Promise<void> => {
  try {
    const resolved = await resolveRemoteStep(ctx, executorCtx, stepCommand);
    if (!resolved) return;
    await syncFromRemote(buildRemoteWorkspaceContext(resolved.config, executorCtx, branch));
  } catch (error) {
    logger.warn("syncFromRemote failed (best-effort): {error}", {
      error: String(error),
      taskId: executorCtx.task.id,
    });
  }
};

const buildStepUsageRecord = (
  stepId: string,
  startedAt: string | null,
  usage: ExecuteResult["usage"],
): NewStepUsage => {
  const endedAt = new Date();
  const durationMs = startedAt
    ? Math.max(0, endedAt.getTime() - new Date(startedAt).getTime())
    : null;

  return {
    step_execution_id: stepId,
    provider: usage?.provider ?? null,
    model: usage?.model ?? null,
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null,
    cost_usd: usage?.costUsd ?? null,
    duration_ms: durationMs,
    usage_source: usage ? "provider_log" : "wall_clock",
    raw_usage_json: usage ? JSON.stringify(usage) : null,
    created_at: endedAt.toISOString(),
  };
};

const persistStepUsage = async (
  ctx: LocalServerContext,
  stepId: string,
  result: ExecuteResult,
): Promise<void> => {
  try {
    const stepExecution = await ctx.executionRepository.getStepExecution(stepId);
    if (!stepExecution) return;
    await ctx.executionRepository.saveStepUsage(
      buildStepUsageRecord(stepId, stepExecution.started_at, result.usage),
    );
  } catch (error) {
    logger.warn("Failed to persist step usage: {error}", {
      stepId,
      error: String(error),
    });
  }
};
