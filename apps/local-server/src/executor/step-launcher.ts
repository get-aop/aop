import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyRuntimeConfigurationToAgent,
  type ExecHostConfig,
  mapRuntimeReasoningEffort,
} from "@aop/common";
import type { ExecutionInfo, SignalDefinition, StepAgent, StepCommand } from "@aop/common/protocol";
import type { WorktreeInfo } from "@aop/git-manager";
import { type ExecHost, getLogger } from "@aop/infra";
import {
  buildOpenClawResultLog,
  CodexCliProvider,
  createProvider,
  getOpenClawRawLogPaths,
  inferRunOutcomeFromRawJsonl,
  type LLMProvider,
  parseRawJsonlContent,
  type RunIsolation,
  type RunResult,
  sanitizeSessionId,
} from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { createExecHostsService } from "../exec-hosts/service.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { isAgentRunning } from "./process-utils.ts";
import type { ExecutorContext, StepWithTask } from "./types.ts";

const logger = getLogger("executor");

export interface SpawnAgentOptions {
  ctx: LocalServerContext;
  executorCtx: ExecutorContext;
  worktreeInfo: WorktreeInfo;
  prompt: string;
  stepId: string;
  executionId: string;
  stepCommand: StepCommand;
  executionInfo: ExecutionInfo;
  taskId: string;
  repoId: string;
  signals?: SignalDefinition[];
  provider?: LLMProvider;
}

export type HandleAgentCompletionFn = (
  opts: SpawnAgentOptions,
  logFile: string,
  runResult: RunResult,
  signals: SignalDefinition[],
) => Promise<void>;

export const REAPER_POLL_INTERVAL_MS = 2000;
const PROVIDER_RUN_GRACE_MS = 1500;

/** Reads JSONL log file and infers process outcome from shared log semantics. */
export const readRunResultFromLog = (logFile: string): RunResult => {
  if (!existsSync(logFile) && !recoverOpenClawLog(logFile)) {
    return { exitCode: 1 };
  }

  const content = readFileSync(logFile, "utf-8");
  const inferred = inferRunOutcomeFromRawJsonl(content, { requireCompleteLine: true });
  const result: RunResult = {
    exitCode: inferred.outcome === "success" ? 0 : 1,
  };
  const sessionId = sanitizeSessionId(readSessionIdFromRawJsonl(content));
  if (sessionId) {
    result.sessionId = sessionId;
  }
  return result;
};

const readSessionIdFromRawJsonl = (content: string): string | undefined => {
  let sessionId: string | undefined;

  for (const entry of parseRawJsonlContent(content).entries) {
    const nextSessionId = findSessionId(entry.event);
    if (nextSessionId) {
      sessionId = nextSessionId;
    }
  }

  return sessionId;
};

const findSessionId = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const directSessionId = record.session_id ?? record.sessionId;
  if (typeof directSessionId === "string" && directSessionId.length > 0) {
    return directSessionId;
  }

  for (const nestedValue of Object.values(record)) {
    const nestedSessionId = findSessionId(nestedValue);
    if (nestedSessionId) {
      return nestedSessionId;
    }
  }

  return undefined;
};

const readOptionalTextFile = (path: string): string => {
  if (!existsSync(path)) {
    return "";
  }

  return readFileSync(path, "utf-8");
};

const cleanupOptionalFile = (path: string): void => {
  try {
    unlinkSync(path);
  } catch {
    // Recovery should remain best-effort; stale temp logs are not fatal.
  }
};

const recoverOpenClawLog = (logFile: string): boolean => {
  const rawPaths = getOpenClawRawLogPaths(logFile);
  const stdout = readOptionalTextFile(rawPaths.stdout);
  const stderr = readOptionalTextFile(rawPaths.stderr);

  if (!stdout && !stderr) {
    return false;
  }

  const recoveredExitCode = stdout.trim().length > 0 ? 0 : 1;
  writeFileSync(logFile, buildOpenClawResultLog({ stdout, stderr, exitCode: recoveredExitCode }));
  cleanupOptionalFile(rawPaths.stdout);
  cleanupOptionalFile(rawPaths.stderr);
  return true;
};

export const createProviderForStepAgent = (agent: StepAgent): LLMProvider => {
  if (agent.provider === "claude-code") {
    return createProvider("claude-code");
  }

  if (agent.provider === "codex-cli") {
    return new CodexCliProvider();
  }

  if (agent.provider === "grok-build") {
    return createProvider("grok-build");
  }

  if (agent.provider === "opencode") {
    return createProvider(`opencode:${agent.model}`);
  }

  return createProvider(agent.provider);
};

const missingStepRuntimeError = (): Error => new Error("Workflow step must define agent runtime");

interface ResolvedStepProvider {
  provider: LLMProvider;
  model?: string;
  reasoningEffort?: string;
  runtimeAlias?: string;
  ultracode?: boolean;
  browserControl?: boolean;
  computerControl?: boolean;
}

const resolveFastMode = (
  globalFastMode: boolean,
  stepCommand: StepCommand,
  provider: LLMProvider,
): boolean => {
  if (provider.name === "pi" || provider.name === "opencode") {
    return false;
  }

  if (stepCommand.agent) {
    return stepCommand.agent.fastMode ?? false;
  }

  if (globalFastMode) {
    return true;
  }

  return false;
};

const resolveProviderForStep = (
  stepCommand: StepCommand,
  fallbackProvider?: LLMProvider,
): ResolvedStepProvider => {
  const stepAgent = stepCommand.agent;
  const shouldBypassStepAgent =
    fallbackProvider?.name === "e2e-fixture" || fallbackProvider?.name === "pi";

  if (!stepAgent || shouldBypassStepAgent) {
    if (!fallbackProvider) {
      throw missingStepRuntimeError();
    }

    return { provider: fallbackProvider };
  }

  const provider = createProviderForStepAgent(stepAgent);
  const resolved: ResolvedStepProvider = {
    provider,
    reasoningEffort: mapRuntimeReasoningEffort(stepAgent.reasoning),
    runtimeAlias: normalizeRuntimeString(stepAgent.runtimeAlias),
    ultracode: stepAgent.provider === "claude-code" ? (stepAgent.ultracode ?? false) : false,
    browserControl: stepAgent.browserControl ?? false,
    computerControl: stepAgent.computerControl ?? false,
  };

  if (supportsExplicitModel(stepAgent.provider)) {
    resolved.model = normalizeRuntimeModel(stepAgent.model);
  }

  return resolved;
};

const supportsExplicitModel = (provider: StepAgent["provider"]): boolean =>
  provider === "claude-code" ||
  provider === "codex-cli" ||
  provider === "grok-build" ||
  provider === "pi";

const resolveRuntimeConfiguredStepCommand = async (
  ctx: LocalServerContext,
  stepCommand: StepCommand,
): Promise<StepCommand> => {
  const agent = stepCommand.agent;
  if (!agent?.runtimeConfigurationId) return stepCommand;

  const configuration = await createRuntimeConfigurationRepository(ctx.db).get(
    agent.runtimeConfigurationId,
  );
  if (!configuration) {
    throw new Error(`Runtime configuration ${agent.runtimeConfigurationId} not found`);
  }
  const resolvedAgent = applyRuntimeConfigurationToAgent(agent, configuration);
  if (!resolvedAgent) {
    throw new Error(`Runtime configuration ${agent.runtimeConfigurationId} is not runnable`);
  }
  return { ...stepCommand, agent: resolvedAgent };
};

const normalizeRuntimeModel = (value: unknown): string | undefined => {
  const normalized = normalizeRuntimeString(value);
  return normalized === "default" ? undefined : normalized;
};

const normalizeRuntimeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const spawnAgentWithReaper = async (
  opts: SpawnAgentOptions,
  onCompletion: HandleAgentCompletionFn,
): Promise<void> => {
  const {
    ctx,
    executorCtx,
    stepId,
    taskId,
    prompt,
    signals = [],
    provider: explicitProvider,
  } = opts;

  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  const stepCommand = await resolveRuntimeConfiguredStepCommand(ctx, opts.stepCommand);
  const {
    provider,
    model,
    reasoningEffort,
    runtimeAlias,
    ultracode,
    browserControl,
    computerControl,
  } = resolveProviderForStep(stepCommand, explicitProvider);

  if ((provider.name === "pi" || provider.name === "opencode") && stepCommand.resumeSessionId) {
    await ctx.executionRepository.updateStepExecution(stepId, {
      session_id: stepCommand.resumeSessionId,
    });
  }

  const logFile = join(executorCtx.logsDir, `${stepId}.jsonl`);
  const timeoutMs = executorCtx.timeoutSecs * 1000;
  const execHost = await resolveExecHostForStep(ctx, stepCommand, executorCtx, taskId);

  // Agents are spawned as detached + unref'd processes so they survive server restarts.
  // provider.run() awaits proc.exited which may never resolve for unref'd processes.
  // We race two completion paths: provider resolution vs PID polling.
  const runResult = await spawnAndReap(ctx, provider, logFile, {
    prompt,
    cwd: executorCtx.worktreePath,
    logFilePath: logFile,
    env: { AOP_TASK_ID: taskId, AOP_STEP_ID: stepId },
    model,
    reasoningEffort,
    runtimeAlias,
    ultracode,
    browserControl,
    computerControl,
    stepId,
    inactivityTimeoutMs: timeoutMs,
    fastMode: resolveFastMode(executorCtx.fastMode, stepCommand, provider),
    resumeSessionId: stepCommand.resumeSessionId,
    isolation: stepCommand.isolation,
    execHost,
  });

  return onCompletion(opts, logFile, runResult, signals);
};

/** Polls until the process is no longer running (exited or zombie). */
export const pollForProcessExit = (pid: number): Promise<void> => {
  return new Promise((resolve) => {
    if (!isAgentRunning(pid)) {
      resolve();
      return;
    }

    const interval = setInterval(() => {
      if (!isAgentRunning(pid)) {
        clearInterval(interval);
        resolve();
      }
    }, REAPER_POLL_INTERVAL_MS);
  });
};

/**
 * Reattaches to a running agent process from a previous server session.
 * Waits for the process to exit, then runs the normal completion pipeline
 * (log persistence -> completeStep on server -> next step chain).
 */
export const reattachToRunningAgent = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  buildContextFn: (ctx: LocalServerContext, task: Task) => Promise<ExecutorContext>,
  createWorktreeFn: (ctx: ExecutorContext) => Promise<WorktreeInfo>,
  onCompletion: HandleAgentCompletionFn,
  provider?: LLMProvider,
): Promise<void> => {
  const task = await ctx.taskRepository.get(step.task_id);
  if (!task) throw new Error(`Task not found: ${step.task_id}`);

  const executorCtx = await buildContextFn(ctx, task);
  const worktreeInfo = await createWorktreeFn(executorCtx);

  const logFile = join(executorCtx.logsDir, `${step.id}.jsonl`);
  ctx.logFlusher.track(step.id, logFile);

  const pid = step.agent_pid;
  if (pid) {
    await pollForProcessExit(pid);
  }
  const runResult = readRunResultFromLog(logFile);
  const signals = step.signals_json ? JSON.parse(step.signals_json) : [];

  const opts: SpawnAgentOptions = {
    ctx,
    executorCtx,
    worktreeInfo,
    prompt: "",
    stepId: step.id,
    executionId: step.execution_id,
    stepCommand: {
      id: step.id,
      type: step.step_type ?? "unknown",
      stepId: step.step_id ?? undefined,
      promptTemplate: "",
      signals,
      attempt: step.attempt ?? 1,
      iteration: step.iteration ?? 1,
    },
    executionInfo: {
      id: step.execution_id,
      workflowId: "",
    },
    taskId: step.task_id,
    repoId: task.repo_id,
    provider,
  };

  await onCompletion(opts, logFile, runResult, signals);
};

// --- Private helpers ---

interface SpawnAndReapOptions {
  prompt: string;
  cwd?: string;
  logFilePath: string;
  env: Record<string, string>;
  model?: string;
  reasoningEffort?: string;
  runtimeAlias?: string;
  ultracode?: boolean;
  browserControl?: boolean;
  computerControl?: boolean;
  stepId: string;
  inactivityTimeoutMs?: number;
  fastMode?: boolean;
  resumeSessionId?: string;
  isolation?: RunIsolation;
  execHost?: ExecHost;
}

/** Resolve optional SSH host for a step; throws a descriptive error if missing/unreachable. */
export const resolveExecHostForStep = async (
  ctx: LocalServerContext,
  stepCommand: StepCommand,
  executorCtx: ExecutorContext,
  taskId: string,
): Promise<ExecHost | undefined> => {
  const resolved = await createExecHostsService(ctx).resolveStepExecHost(
    stepCommand.agent?.execHostId,
    { worktreePath: executorCtx.worktreePath, taskId },
  );
  if (!resolved) return undefined;
  await preflightExecHost(resolved.host, resolved.config);
  return resolved.host;
};

const PREFLIGHT_TIMEOUT_MS = 8_000;

/** The remote must answer a trivial command before spawn (fail fast instead of hanging). */
const preflightExecHost = async (host: ExecHost, config: ExecHostConfig): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probe = host.shell("echo aop-preflight", {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await Promise.race([
      probe.exited,
      new Promise<number>((resolve) => {
        timer = setTimeout(() => resolve(124), PREFLIGHT_TIMEOUT_MS);
      }),
    ]);
    if (exitCode === 124) {
      probe.kill();
      throw new Error(`preflight timed out after ${PREFLIGHT_TIMEOUT_MS / 1000}s`);
    }
    if (exitCode !== 0) {
      throw new Error(`exit ${exitCode}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Execution host "${config.name}" (${config.host}) is unreachable: ${detail}. ` +
        "Check SSH key auth (BatchMode) and network reachability.",
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Spawns the agent and waits for completion via whichever path resolves first:
 * - Path A: provider.run() resolves (proc.exited works, or mock provider)
 * - Path B: PID polling detects process exit/zombie (primary path for detached+unref agents)
 */
const spawnAndReap = (
  ctx: LocalServerContext,
  provider: LLMProvider,
  logFile: string,
  opts: SpawnAndReapOptions,
): Promise<RunResult> => {
  return new Promise<RunResult>((resolve, reject) => {
    let settled = false;
    let reaping = false;
    let pollInterval: Timer | undefined;
    let providerRunPromise: Promise<RunResult> | null = null;
    let spawnedPid: number | null = null;

    const settle = (result: RunResult) => {
      if (settled) return;
      settled = true;
      if (pollInterval) clearInterval(pollInterval);
      resolve(result);
    };

    const settleFromPollPath = async () => {
      if (settled || reaping) return;
      reaping = true;
      const providerResult = await waitForProviderRun(providerRunPromise, PROVIDER_RUN_GRACE_MS);
      settle(providerResult ?? readRunResultFromLog(logFile));
    };

    providerRunPromise = provider.run({
      prompt: opts.prompt,
      cwd: opts.cwd,
      isolation: opts.isolation ?? "hermetic",
      logFilePath: opts.logFilePath,
      env: opts.env,
      model: opts.model,
      reasoningEffort: opts.reasoningEffort,
      runtimeAlias: opts.runtimeAlias,
      ultracode: opts.ultracode,
      browserControl: opts.browserControl,
      computerControl: opts.computerControl,
      resumeSessionId: opts.resumeSessionId,
      execHost: opts.execHost,
      disallowedTools: ["Skill"],
      onSession: async (sessionId) => {
        await ctx.executionRepository.updateStepExecution(opts.stepId, {
          session_id: sessionId,
        });
      },
      onSpawn: async (pid) => {
        spawnedPid = pid;
        await ctx.executionRepository.updateStepExecution(opts.stepId, {
          agent_pid: pid,
        });
        ctx.logFlusher.track(opts.stepId, logFile);
        logger.info("Agent spawned with PID {pid}", { pid, stepId: opts.stepId });

        // Start PID polling — the primary completion mechanism for detached agents
        if (!isAgentRunning(pid)) {
          void settleFromPollPath();
          return;
        }
        pollInterval = setInterval(() => {
          if (!isAgentRunning(pid)) {
            void settleFromPollPath();
          }
        }, REAPER_POLL_INTERVAL_MS);
      },
      inactivityTimeoutMs: opts.inactivityTimeoutMs,
      fastMode: opts.fastMode,
    });

    providerRunPromise
      .then((runResult) => {
        if (!spawnedPid) {
          settle(runResult);
          return;
        }

        // Detached providers can resolve after writing the result line but before the
        // agent process has actually exited. Wait for PID polling in that case so
        // completion handlers do not remove an in-use worktree.
        if (!isAgentRunning(spawnedPid)) {
          settle(runResult);
        }
      })
      .catch((err) => {
        if (!settled) reject(err);
      });
  });
};

const waitForProviderRun = async (
  providerRunPromise: Promise<RunResult> | null,
  timeoutMs: number,
): Promise<RunResult | null> => {
  if (!providerRunPromise) return null;

  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([providerRunPromise, timeout]);
  } catch {
    return null;
  }
};
