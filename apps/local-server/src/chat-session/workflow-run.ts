import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { mapRuntimeReasoningEffort } from "@aop/common";
import type { SignalDefinition } from "@aop/common/protocol";
import { aopPaths, getLogger } from "@aop/infra";
import type { LLMProvider, RunResult } from "@aop/llm-provider";
import Handlebars from "handlebars";
import type { LocalServerContext } from "../context.ts";
import type { WorkflowRun, WorkflowRunStatus } from "../db/schema.ts";
import { processAgentCompletion } from "../executor/completion-handler.ts";
import { isAgentRunning } from "../executor/process-utils.ts";
import { createProviderForStepAgent, readRunResultFromLog } from "../executor/step-launcher.ts";
import type { ExecuteResult } from "../executor/types.ts";
import { createTemplateLoader, loadOutputSignalsSection } from "../prompts/template-loader.ts";
import { migrateAopDefaultWorkflowDefinition } from "../workflow-engine/aop-default-gpt-migrations.ts";
import { createStepCommandGenerator } from "../workflow-engine/step-command-generator.ts";
import type { StepAgent, WorkflowStep } from "../workflow-engine/types.ts";
import { parseWorkflow } from "../workflow-engine/workflow-parser.ts";
import {
  createWorkflowStateMachine,
  type TransitionResult,
  type WorkflowStateMachine,
} from "../workflow-engine/workflow-state-machine.ts";
import { CHAT_STARTUP_TIMEOUT_MS } from "./runtime-engine.ts";
import { publishChatSessionEvent } from "./session-events.ts";

const logger = getLogger("chat-workflow-run");

const REAPER_POLL_INTERVAL_MS = 2_000;

/** In-flight executions, so tests can await completion. */
const activeRuns = new Map<string, Promise<void>>();

export const waitForPendingWorkflowRuns = async (): Promise<void> => {
  await Promise.allSettled([...activeRuns.values()]);
  activeRuns.clear();
};

export const hasActiveWorkflowRun = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<boolean> => {
  const run = await ctx.db
    .selectFrom("workflow_runs")
    .select("id")
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .executeTakeFirst();
  return run !== undefined;
};

/** Marks runs left running by a crashed server as failed so sessions can retry. */
export const interruptStaleWorkflowRuns = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<void> => {
  await ctx.db
    .updateTable("workflow_runs")
    .set({
      status: "failed",
      error_message: "Interrupted: the AOP server restarted mid-run",
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .execute();
};

export const createWorkflowRunRecord = async (
  ctx: LocalServerContext,
  input: {
    sessionId: string;
    workflowId: string;
    workflowName: string;
    request: string;
    userMessageId: string;
  },
): Promise<WorkflowRun> => {
  const now = new Date().toISOString();
  return ctx.db
    .insertInto("workflow_runs")
    .values({
      id: generateWorkflowRunId(),
      session_id: input.sessionId,
      workflow_id: input.workflowId,
      workflow_name: input.workflowName,
      status: "running",
      request: input.request,
      user_message_id: input.userMessageId,
      current_step_id: null,
      visited_steps: null,
      iteration: 0,
      result: null,
      error_message: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
};

const generateWorkflowRunId = (): string => `wfr_${crypto.randomUUID()}`;

export interface WorkflowRunOutcome {
  status: WorkflowRunStatus;
  answer: string;
  error?: string;
}

/** Runs one chat workflow sequentially: each step spawns its own pinned agent. */
export const executeChatWorkflowRun = async (
  ctx: LocalServerContext,
  runId: string,
  stepProviderFactory?: (agent: StepAgent) => LLMProvider,
): Promise<WorkflowRunOutcome> => {
  const execution = executeWorkflowRun(ctx, runId, stepProviderFactory)
    .then((outcome) => {
      activeRuns.delete(runId);
      return outcome;
    })
    .catch((error) => {
      activeRuns.delete(runId);
      const detail = error instanceof Error ? error.message : String(error);
      logger.error("Chat workflow run {runId} failed: {detail}", { runId, detail });
      return failWorkflowRun(ctx, runId, detail);
    });
  activeRuns.set(
    runId,
    execution.then(() => undefined),
  );
  return execution;
};

const executeWorkflowRun = async (
  ctx: LocalServerContext,
  runId: string,
  stepProviderFactory?: (agent: StepAgent) => LLMProvider,
): Promise<WorkflowRunOutcome> => {
  const run = await ctx.db
    .selectFrom("workflow_runs")
    .selectAll()
    .where("id", "=", runId)
    .executeTakeFirst();
  if (!run) {
    throw new Error(`Workflow run ${runId} not found`);
  }
  const session = await ctx.chatSessionRepository.getById(run.session_id);
  if (!session) {
    throw new Error(`Chat session ${run.session_id} not found`);
  }
  const workflowRow = await ctx.workflowRepository.findById(run.workflow_id);
  if (!workflowRow?.active) {
    throw new Error(`Workflow "${run.workflow_name}" not found`);
  }
  const workflow = migrateAopDefaultWorkflowDefinition(parseWorkflow(workflowRow.definition));
  const workspacePath = await resolveWorkflowRunWorkspace(ctx, run.session_id);
  if (!workspacePath) {
    throw new Error("Session has no workspace for workflow steps");
  }

  const templateLoader = createTemplateLoader();
  const commandGenerator = createStepCommandGenerator(templateLoader);
  const stateMachine = createWorkflowStateMachine(workflow);
  const steps = Object.values(workflow.steps);
  const stepCount = steps.length;
  const visitedSteps: string[] = [];
  let iteration = 0;
  let currentStep = stateMachine.getInitialStep();
  visitedSteps.push(currentStep.id);
  const accumulated: string[] = [];

  logger.info("Workflow run {runId} started for {workflowName}", {
    runId,
    workflowName: workflow.name,
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const stepIndex = visitedSteps.length - 1;
    const stepOutcome = await runOneWorkflowStep(ctx, {
      run,
      runId,
      step: currentStep,
      stepIndex,
      stepCount,
      visitedSteps,
      iteration,
      workspacePath,
      commandGenerator,
      stateMachine,
      stepProviderFactory,
    });
    if (stepOutcome.transition.shouldIncrementIteration) iteration += 1;
    accumulated.push(stepOutcome.result.assistantOutput);

    if (stepOutcome.transition.type !== "step") {
      return finishTerminalRun(
        ctx,
        runId,
        run.session_id,
        stepOutcome.transition,
        accumulated,
        stepOutcome.result.assistantOutput,
      );
    }

    currentStep = stepOutcome.transition.step;
    visitedSteps.push(currentStep.id);
  }
};

const runOneWorkflowStep = async (
  ctx: LocalServerContext,
  input: {
    run: WorkflowRun;
    runId: string;
    step: WorkflowStep;
    stepIndex: number;
    stepCount: number;
    visitedSteps: string[];
    iteration: number;
    workspacePath: string;
    commandGenerator: ReturnType<typeof createStepCommandGenerator>;
    stateMachine: WorkflowStateMachine;
    stepProviderFactory?: (agent: StepAgent) => LLMProvider;
  },
): Promise<{ result: ExecuteResult; transition: TransitionResult }> => {
  const { run, runId, step, stepIndex, stepCount, visitedSteps, iteration, workspacePath } = input;
  await updateRunProgress(ctx, runId, step.id, visitedSteps, iteration);
  publishChatSessionEvent({
    type: "workflow-run-step",
    sessionId: run.session_id,
    runId,
    index: stepIndex,
    stepCount,
    stepId: step.id,
    stepType: step.type,
    status: "started",
  });

  const stepCommand = await input.commandGenerator.generate(
    step,
    `${runId}-${step.id}`,
    1,
    iteration,
  );
  const prompt = await buildStepPrompt({
    template: stepCommand.promptTemplate,
    signals: stepCommand.signals ?? [],
    workspacePath,
    request: run.request,
    stepType: step.type,
  });
  const logFile = await createWorkflowRunLogPath(run.session_id, runId, step.id);
  const agent = stepCommand.agent;
  if (!agent) {
    throw new Error(`Step "${step.id}" has no pinned agent`);
  }
  const provider = input.stepProviderFactory
    ? input.stepProviderFactory(agent)
    : createProviderForStepAgent(agent);
  const runResult = await runStepAgent(provider, {
    runId,
    stepId: step.id,
    prompt,
    cwd: workspacePath,
    logFilePath: logFile,
    agent,
  });

  const result = processAgentCompletion(logFile, runResult, stepCommand.signals ?? []);
  publishChatSessionEvent({
    type: "workflow-run-step",
    sessionId: run.session_id,
    runId,
    index: stepIndex,
    stepCount,
    stepId: step.id,
    stepType: step.type,
    status: "finished",
    resultStatus: result.status,
  });

  const transition = input.stateMachine.evaluateTransition(
    step.id,
    { status: result.status === "timeout" ? "failure" : result.status, signal: result.signal },
    { iteration, visitedSteps },
  );

  logger.info("Workflow run {runId} step {stepId} → {transition}", {
    runId,
    stepId: step.id,
    transition: transition.type,
  });

  return { result, transition };
};

const finishTerminalRun = async (
  ctx: LocalServerContext,
  runId: string,
  sessionId: string,
  transition: TransitionResult,
  accumulated: string[],
  lastOutput: string,
): Promise<WorkflowRunOutcome> => {
  const status: WorkflowRunStatus =
    transition.type === "done" ? "done" : transition.type === "blocked" ? "blocked" : "paused";
  const answer = buildTerminalAnswer(status, lastOutput, accumulated);
  await postWorkflowRunAnswer(ctx, runId, sessionId, status, answer);
  return { status, answer };
};

const buildTerminalAnswer = (
  status: WorkflowRunStatus,
  lastOutput: string,
  accumulated: string[],
): string => {
  if (status === "done") {
    return lastOutput.trim().length > 0 ? lastOutput : accumulated.join("\n\n").trim();
  }
  if (status === "blocked") {
    return (
      "The workflow was blocked before finishing.\n\n" +
      (lastOutput.trim().length > 0 ? lastOutput : accumulated.join("\n\n").trim())
    );
  }
  return "The workflow paused and needs your input before continuing.";
};

const updateRunProgress = async (
  ctx: LocalServerContext,
  runId: string,
  currentStepId: string,
  visitedSteps: string[],
  iteration: number,
): Promise<void> => {
  await ctx.db
    .updateTable("workflow_runs")
    .set({
      current_step_id: currentStepId,
      visited_steps: JSON.stringify(visitedSteps),
      iteration,
      updated_at: new Date().toISOString(),
    })
    .where("id", "=", runId)
    .execute();
};

const resolveWorkflowRunWorkspace = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<string | null> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session?.workspace_path) return null;
  return session.workspace_path;
};

const SIGNALS_SECTION_PATTERN = /\{\{\s*#each signals\s*\}\}|\{\{\s*>\s*output-signals\s*\}\}/;

const buildStepPrompt = async (input: {
  template: string;
  signals: SignalDefinition[];
  workspacePath: string;
  request: string;
  stepType: string;
}): Promise<string> => {
  let template = input.template;
  if (input.signals.length > 0 && !SIGNALS_SECTION_PATTERN.test(template)) {
    template = `${template.trimEnd()}\n\n${await loadOutputSignalsSection()}`;
  }
  const compiled = Handlebars.compile(template, { noEscape: true });
  const rendered = compiled({
    task: {},
    worktree: { path: input.workspacePath },
    signals: input.signals,
    stepType: input.stepType,
    iteration: 0,
  });
  return `${rendered}\n\n## User request\n${input.request}`;
};

const runStepAgent = async (
  provider: LLMProvider,
  opts: {
    runId: string;
    stepId: string;
    prompt: string;
    cwd: string;
    logFilePath: string;
    agent: StepAgent;
  },
): Promise<RunResult> => {
  let spawnedPid: number | null = null;
  const providerRunPromise = provider.run({
    prompt: opts.prompt,
    cwd: opts.cwd,
    logFilePath: opts.logFilePath,
    env: { AOP_WORKFLOW_RUN_ID: opts.runId, AOP_STEP_ID: opts.stepId },
    model: supportsExplicitModel(opts.agent.provider)
      ? normalizeRuntimeModel(opts.agent.model)
      : undefined,
    reasoningEffort: mapRuntimeReasoningEffort(opts.agent.reasoning),
    fastMode: opts.agent.fastMode ?? false,
    browserControl: opts.agent.browserControl ?? false,
    computerControl: opts.agent.computerControl ?? false,
    startupTimeoutMs: CHAT_STARTUP_TIMEOUT_MS,
    disallowedTools: ["Skill"],
    onSpawn: (pid) => {
      spawnedPid = pid;
    },
  });

  // Detached providers may never resolve provider.run(); race it against PID
  // polling (mirrors the task executor's reaper) and fall back to the log.
  const providerResult = await Promise.race([
    providerRunPromise.catch(() => null),
    pollForProcessExit(() => spawnedPid),
  ]);
  return providerResult ?? readRunResultFromLog(opts.logFilePath);
};

const failWorkflowRun = async (
  ctx: LocalServerContext,
  runId: string,
  detail: string,
): Promise<WorkflowRunOutcome> => {
  const run = await ctx.db
    .selectFrom("workflow_runs")
    .selectAll()
    .where("id", "=", runId)
    .executeTakeFirst();
  if (!run) return { status: "failed", answer: "", error: detail };
  const answer = `The workflow run failed before finishing.\n\n${detail}`;
  await postWorkflowRunAnswer(ctx, runId, run.session_id, "failed", answer);
  return { status: "failed", answer, error: detail };
};

const pollForProcessExit = async (getPid: () => number | null): Promise<RunResult | null> => {
  return new Promise((resolve) => {
    const poll = (): void => {
      const pid = getPid();
      if (pid !== null && !isAgentRunning(pid)) {
        // Grace for the provider to write its final result line.
        setTimeout(() => resolve(null), 2_000);
        return;
      }
      setTimeout(poll, REAPER_POLL_INTERVAL_MS);
    };
    setTimeout(poll, REAPER_POLL_INTERVAL_MS);
  });
};

const createWorkflowRunLogPath = async (
  sessionId: string,
  runId: string,
  stepId: string,
): Promise<string> => {
  const dir = join(aopPaths.logs(), "chat-workflow", sessionId);
  await mkdir(dir, { recursive: true });
  return join(dir, `${runId}-${stepId}.jsonl`);
};

const supportsExplicitModel = (provider: StepAgent["provider"]): boolean =>
  provider === "claude-code" ||
  provider === "codex-cli" ||
  provider === "grok-build" ||
  provider === "pi";

const normalizeRuntimeModel = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "default" ? trimmed : undefined;
};

const postWorkflowRunAnswer = async (
  ctx: LocalServerContext,
  runId: string,
  sessionId: string,
  status: Exclude<WorkflowRunStatus, "running">,
  answer: string,
): Promise<void> => {
  const now = new Date().toISOString();
  const answerMessageId = generateChatMessageId();
  const turnIndex = await nextChatTurnIndex(ctx, sessionId);

  await ctx.db
    .insertInto("chat_messages")
    .values({
      id: answerMessageId,
      session_id: sessionId,
      role: "assistant",
      content: answer,
      action: null,
      activity: null,
      turn_index: turnIndex,
      disposition: "immediate",
      created_at: now,
    })
    .execute();

  await ctx.db
    .updateTable("workflow_runs")
    .set({
      status,
      result: answer,
      answer_message_id: answerMessageId,
      updated_at: now,
      completed_at: now,
    })
    .where("id", "=", runId)
    .execute();

  const message = await ctx.db
    .selectFrom("chat_messages")
    .selectAll()
    .where("id", "=", answerMessageId)
    .executeTakeFirstOrThrow();

  publishChatSessionEvent({
    type: "workflow-run-completed",
    sessionId,
    runId,
    status,
    answer,
  });
  publishChatSessionEvent({
    type: "assistant-final",
    sessionId,
    message: toWorkflowRunMessageDto(message),
  });
  logger.info("Workflow run {runId} finished as {status}", { runId, status });
};

const generateChatMessageId = (): string => `smsg_${crypto.randomUUID()}`;

const nextChatTurnIndex = async (ctx: LocalServerContext, sessionId: string): Promise<number> => {
  const row = await ctx.db
    .selectFrom("chat_messages")
    .select(({ fn }) => fn.max<number>("turn_index").as("max"))
    .where("session_id", "=", sessionId)
    .executeTakeFirst();
  return Number(row?.max ?? -1) + 1;
};

const toWorkflowRunMessageDto = (message: {
  id: string;
  session_id: string;
  role: string;
  content: string;
  action: string | null;
  activity: string | null;
  turn_index: number;
  disposition: string;
  created_at: string;
}): import("./service.ts").ChatMessageDto => ({
  id: message.id,
  sessionId: message.session_id,
  role: message.role as import("./service.ts").ChatMessageDto["role"],
  content: message.content,
  action: null,
  activity: null,
  createdAt: message.created_at,
  images: [],
  documents: [],
  artifacts: [],
  disposition: message.disposition as import("./service.ts").ChatMessageDto["disposition"],
});
