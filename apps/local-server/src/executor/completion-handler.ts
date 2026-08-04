import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import type { ExecutionInfo, SignalDefinition, StepCommand } from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import {
  extractAssistantSignalTextFromRawJsonl,
  extractUsageFromRawJsonl,
  type RunResult,
} from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { detectSignal } from "../orchestrator/sync/signal-detector.ts";
import { SettingKey } from "../settings/types.ts";
import { handoffCompletedTask } from "../task/handoff.ts";
import type { ExecuteResult } from "./types.ts";

const logger = getLogger("executor");

interface AgentLogAnalysis {
  assistantText: string;
  signalTextComplete: boolean;
  usage?: ExecuteResult["usage"];
}

export const processAgentCompletion = (
  logFile: string,
  runResult: RunResult,
  signals: SignalDefinition[],
): ExecuteResult => {
  const log = readAgentLogAnalysis(logFile, runResult);
  const status = runResult.timedOut ? "timeout" : runResult.exitCode === 0 ? "success" : "failure";
  const signal =
    status === "success" && log.signalTextComplete
      ? detectSignal(log.assistantText, signals).signal
      : undefined;
  const pauseContext =
    signal === "REQUIRES_INPUT" ? extractPauseContext(log.assistantText) : undefined;

  return {
    exitCode: runResult.exitCode,
    sessionId: runResult.sessionId,
    status,
    signal,
    pauseContext,
    assistantOutput: log.assistantText,
    ...(log.usage ? { usage: log.usage } : {}),
  };
};

const readAgentLogAnalysis = (logFile: string, runResult: RunResult): AgentLogAnalysis => {
  if (!existsSync(logFile)) {
    return { assistantText: "", signalTextComplete: true };
  }

  const content = readFileSync(logFile, "utf-8");
  const extracted = extractAssistantSignalTextFromRawJsonl(content, {
    requireCompleteLine: true,
  });

  if (!extracted.isComplete) {
    logger.warn("Skipping signal detection due to partial trailing JSONL entry", { logFile });
  }

  return {
    assistantText: extracted.text,
    signalTextComplete: extracted.isComplete,
    usage: runResult.usage ?? extractUsageFromRawJsonl(content),
  };
};

export const populateLogBuffer = (
  ctx: LocalServerContext,
  logFile: string,
  stepExecutionId: string,
): void => {
  if (!existsSync(logFile)) return;

  const content = readFileSync(logFile, "utf-8");
  const lines = content.split("\n").filter((line) => line.length > 0);
  for (const rawLine of lines) {
    ctx.logBuffer.push(stepExecutionId, rawLine);
  }
};

export const cleanupLogFile = (logFile: string): void => {
  try {
    unlinkSync(logFile);
  } catch (err) {
    logger.warn("Failed to cleanup log file: {error}", {
      logFile,
      error: String(err),
    });
  }
};

export const persistStepLogs = async (
  ctx: LocalServerContext,
  stepExecutionId: string,
): Promise<void> => {
  const lines = ctx.logBuffer.getLines(stepExecutionId);
  if (lines.length === 0) return;

  const now = new Date().toISOString();
  const logs = lines.map((rawLine) => ({
    step_execution_id: stepExecutionId,
    content: rawLine,
    created_at: now,
  }));

  try {
    await ctx.executionRepository.saveStepLogs(logs);
    logger.debug("Persisted {count} log lines for step execution {stepExecutionId}", {
      count: logs.length,
      stepExecutionId,
    });
  } catch (err) {
    logger.warn("Failed to persist step logs: {error}", {
      stepExecutionId,
      error: String(err),
    });
  }
};

export interface NextStepInfo {
  step: StepCommand;
  execution: ExecutionInfo;
}

export const finalizeExecutionAndGetNextStep = async (
  ctx: LocalServerContext,
  taskId: string,
  executionId: string,
  stepId: string,
  result: ExecuteResult,
): Promise<NextStepInfo | null> => {
  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    logger.error("Task not found during finalization", { taskId });
    return null;
  }

  const completion = await ctx.workflowService.completeStep(task, {
    executionId,
    stepId,
    status: result.status === "success" ? "success" : "failure",
    signal: result.signal,
    pauseContext: result.pauseContext,
    assistantOutput: result.assistantOutput,
  });

  if (completion.taskStatus === "DONE") {
    const requiresApproval = await resolveHandoffRequiresApproval(ctx, task);
    if (requiresApproval) {
      await ctx.taskRepository.update(taskId, { handoff_pending_approval: true });
      return null;
    }

    try {
      await handoffCompletedTask(ctx, taskId);
    } catch (error) {
      logger.error("Automatic task handoff failed: {error}", {
        taskId,
        error: String(error),
      });
    }
  }

  if (completion.step && completion.execution && completion.taskStatus === "WORKING") {
    return {
      step: completion.step,
      execution: completion.execution,
    };
  }

  return null;
};

const resolveHandoffRequiresApproval = async (
  ctx: LocalServerContext,
  task: Task,
): Promise<boolean> => {
  if (task.handoff_requires_approval_override !== null) {
    return task.handoff_requires_approval_override === true;
  }

  return (await ctx.settingsRepository.get(SettingKey.HANDOFF_REQUIRES_APPROVAL)) === "true";
};

export const extractPauseContext = (output: string): string | undefined => {
  const lines = output.split("\n");
  const contextLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("INPUT_REASON:") || line.startsWith("INPUT_TYPE:")) {
      contextLines.push(line);
    }
  }

  return contextLines.length > 0 ? contextLines.join("\n") : undefined;
};

export const ensureDir = (dir: string): void => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};
