import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateWorkflowRuntimeAgent } from "@aop/common";
import type {
  SignalDefinition,
  StepCompleteResponse,
  TaskReadyResponse,
} from "@aop/common/protocol";
import { generateTypeId, getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Execution, Task } from "../db/schema.ts";
import { createTemplateLoader, INLINE_TEMPLATE_PREFIX } from "../prompts/template-loader.ts";
import { createSignal, createSignalsFromAgentOutput } from "../signals/service.ts";
import { resolveTaskDir } from "../task-docs/paths.ts";
import {
  migrateAopDefaultWorkflowDefinition,
  normalizeLegacyAopDefaultSkillId,
} from "../workflow-engine/aop-default-gpt-migrations.ts";
import { createStepCommandGenerator } from "../workflow-engine/step-command-generator.ts";
import { STEP_LIBRARY, type StepBlockDefinition } from "../workflow-engine/step-library.ts";
import {
  type StepAgent,
  StepAgentSchema,
  type StepType,
  type Transition,
  TransitionSchema,
  type WorkflowCanvas,
  type WorkflowDefinition,
  type WorkflowStep,
} from "../workflow-engine/types.ts";
import { parseWorkflow } from "../workflow-engine/workflow-parser.ts";
import {
  createWorkflowStateMachine,
  type TransitionResult,
  type WorkflowStateMachine,
} from "../workflow-engine/workflow-state-machine.ts";
import { validateTaskBudget } from "./budget-guard.ts";
import {
  markGeneratedCompletionCriterionChecked,
  validateTaskCompletion,
} from "./completion-guard.ts";
import { syncWorkflows } from "./sync.ts";
import { assertSafeVerifyCommands } from "./verification-command-safety.ts";

const logger = getLogger("local-workflow-service");
const STANDARD_TERMINAL_STATES = ["__done__", "__blocked__", "__paused__", "__draft__"];

const shouldResetRetryPath = (
  latestExecution: { workflow_id: string } | null | undefined,
  workflowName: string,
): boolean => !latestExecution || latestExecution.workflow_id !== workflowName;

const buildRetryVisitedSteps = (retryFromStep: string, previousVisited: string[]): string[] => {
  const index = previousVisited.indexOf(retryFromStep);
  const visitedSteps =
    index >= 0 ? previousVisited.slice(0, index + 1) : [...previousVisited, retryFromStep];
  return visitedSteps.length > 0 ? visitedSteps : [retryFromStep];
};

interface CompleteStepInput {
  executionId: string;
  stepId: string;
  status: "success" | "failure";
  signal?: string;
  pauseContext?: string;
  assistantOutput?: string;
}

export interface LocalWorkflowService {
  listWorkflows: () => Promise<string[]>;
  listWorkflowDetails: () => Promise<WorkflowSummary[]>;
  listStepLibrary: () => Promise<StepBlockDefinition[]>;
  createSkillBlock: (input: CreateSkillBlockInput) => Promise<StepBlockDefinition>;
  deleteSkillBlock: (id: string) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
  createWorkflowFromSteps: (input: CreateWorkflowInput) => Promise<WorkflowSummary>;
  startTask: (task: Task) => Promise<TaskReadyResponse>;
  completeStep: (task: Task, input: CompleteStepInput) => Promise<StepCompleteResponse>;
  resumeTask: (task: Task, stepId: string, input: string) => Promise<StepCompleteResponse>;
}

export interface WorkflowSummaryStep {
  id: string;
  type: string;
  promptTemplate: string;
  maxAttempts: number;
  signals?: SignalDefinition[];
  transitions: Transition[];
  agent?: StepAgent;
  verifyCommands?: string[];
  checkerStep?: boolean;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  version: number;
  active: boolean;
  source: "builtin" | "user";
  stepCount: number;
  steps: WorkflowSummaryStep[];
  canvas?: WorkflowCanvas;
}

export interface CreateWorkflowInput {
  name: string;
  sourceWorkflowId?: string;
  stepIds?: string[];
  steps?: CreateWorkflowStepInput[];
  canvas?: WorkflowCanvas;
}

export interface CreateWorkflowStepInput {
  id?: string;
  skillId: string;
  maxAttempts?: number;
  transitions?: CreateWorkflowTransitionInput[];
  agent?: StepAgent;
  verifyCommands?: string[];
  checkerStep?: boolean;
}

export type CreateWorkflowTransitionInput = Partial<
  Pick<Transition, "maxIterations" | "afterIteration">
> &
  Pick<Transition, "condition" | "target"> & {
    onMaxIterations?: string;
    thenTarget?: string;
  };

export interface CreateSkillBlockInput {
  id: string;
  type: StepType;
  category: StepBlockDefinition["category"];
  description: string;
  signals: SignalDefinition[];
  promptTemplate: string;
  defaults: { maxAttempts: number };
}

interface IterationContext {
  iteration: number;
  visitedSteps: string[];
}

interface LoadedExecutionContext {
  execution: Execution;
  workflow: WorkflowDefinition;
  stateMachine: WorkflowStateMachine;
  iteration: number;
  visitedSteps: string[];
  currentStepId: string;
}

interface PendingStepCompletion {
  ctxState: LoadedExecutionContext;
  transition: TransitionResult;
}

const parseVisitedSteps = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
};

const buildVisitedSteps = (current: string[], nextStepId: string): string[] =>
  current.includes(nextStepId)
    ? [...current.filter((stepId) => stepId !== nextStepId), nextStepId]
    : [...current, nextStepId];

const assertUnreachable = (_value: never): never => {
  throw new Error("Unexpected workflow transition");
};

const resolveCompletedStepStatus = (
  transition: TransitionResult,
  inputStatus: CompleteStepInput["status"],
): "success" | "failure" | "awaiting_input" => {
  if (transition.type === "paused") return "awaiting_input";
  if (transition.type === "blocked" && transition.reason === "missing_required_signal") {
    return "failure";
  }
  return inputStatus;
};

const WORKFLOW_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const STEP_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SIGNAL_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_ATTEMPTS_LIMIT = 50;
const STEP_TYPES: StepType[] = ["implement", "test", "review", "debug", "iterate", "research"];
const STEP_CATEGORIES: StepBlockDefinition["category"][] = [
  "general",
  "backend",
  "frontend",
  "business",
  "research",
];

interface NormalizedWorkflowStepInput {
  id?: string;
  skillId: string;
  maxAttempts?: number;
  transitions?: Transition[];
  agent?: StepAgent;
  verifyCommands?: string[];
  checkerStep?: boolean;
}

const normalizeWorkflowName = (name: string): string => name.trim().toLowerCase();
const normalizeStepId = (id: string): string => id.trim().toLowerCase();
const normalizeOptionalWorkflowId = (id: string | undefined): string | undefined => {
  const trimmed = id?.trim();
  return trimmed ? trimmed : undefined;
};

const summarizeWorkflow = (workflow: {
  id: string;
  name: string;
  definition: string;
  version: number;
  active: boolean;
  source: "builtin" | "user";
}): WorkflowSummary => {
  const definition = migrateAopDefaultWorkflowDefinition(parseWorkflow(workflow.definition));
  const steps = Object.values(definition.steps).map((step) => ({
    id: step.id,
    type: step.type,
    promptTemplate: step.promptTemplate,
    maxAttempts: step.maxAttempts,
    signals: step.signals,
    transitions: step.transitions,
    agent: step.agent,
    verifyCommands: step.verifyCommands,
    checkerStep: step.checkerStep,
  }));

  return {
    id: workflow.id,
    name: workflow.name,
    version: workflow.version,
    active: workflow.active,
    source: workflow.source,
    stepCount: steps.length,
    steps,
    ...(definition.canvas ? { canvas: definition.canvas } : {}),
  };
};

const writeResumeContext = async (
  ctx: LocalServerContext,
  task: Task,
  input: CompleteStepInput,
  currentStepId: string,
): Promise<void> => {
  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    logger.warn("Skipping resume context write because repo was not found", {
      taskId: task.id,
      repoId: task.repo_id,
    });
    return;
  }

  const taskDir = resolveTaskDir(task.repo_id, repo.path, task.change_path);
  await mkdir(taskDir, { recursive: true });
  await writeFile(
    join(taskDir, "resume-context.md"),
    buildResumeContextMarkdown(taskDir, input, currentStepId),
  );
};

const buildResumeContextMarkdown = (
  taskDir: string,
  input: CompleteStepInput,
  currentStepId: string,
): string =>
  [
    "# Resume Context",
    "",
    "## Handoff Principles",
    "",
    "- Reference existing task docs and execution logs by path; do not duplicate plans, commits, diffs, or logs here.",
    "- Redact secrets before persisting handoff or resume context.",
    "- Suggested next states: WORKING after user input unblocks execution, PAUSED if more input is still required, BLOCKED if the task cannot proceed.",
    "",
    "## References",
    "",
    `- Task docs: \`${taskDir}\``,
    `- Execution: \`${input.executionId}\``,
    `- Step execution: \`${input.stepId}\``,
    `- Workflow step: \`${currentStepId}\``,
    "",
    "## Awaiting Input",
    "",
    redactSecrets(input.pauseContext ?? "No structured pause context was provided."),
    "",
  ].join("\n");

const redactSecrets = (value: string): string =>
  value
    .replace(
      /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=([^\s]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]");

const normalizeRetryStepId = (workflow: WorkflowDefinition, stepId: string): string =>
  workflow.name === "aop-default-gpt" ? normalizeLegacyAopDefaultSkillId(stepId) : stepId;

const normalizeVisitedSteps = (
  visitedSteps: string[],
  workflow: WorkflowDefinition,
  stateMachine: WorkflowStateMachine,
): string[] => {
  if (workflow.name !== "aop-default-gpt") {
    return visitedSteps;
  }

  return visitedSteps
    .map((stepId) => normalizeLegacyAopDefaultSkillId(stepId))
    .filter(
      (stepId, index, steps) => stateMachine.getStep(stepId) && steps.indexOf(stepId) === index,
    );
};

const buildWorkflowDefinitionFromSteps = (
  name: string,
  stepInputs: NormalizedWorkflowStepInput[],
  stepBlocks: Map<string, StepBlockDefinition>,
): WorkflowDefinition => {
  const steps: WorkflowDefinition["steps"] = {};
  const workflowStepIds = resolveWorkflowStepIds(stepInputs);

  stepInputs.forEach((stepInput, index) => {
    const stepId = workflowStepIds[index] ?? stepInput.skillId;
    const nextStepId = workflowStepIds[index + 1] ?? "__done__";
    steps[stepId] = buildWorkflowStepFromInput(stepInput, stepId, nextStepId, stepBlocks);
  });

  return {
    version: 1,
    name,
    initialStep: workflowStepIds[0] ?? "",
    steps,
    terminalStates: STANDARD_TERMINAL_STATES,
  };
};

const buildWorkflowStepFromInput = (
  stepInput: NormalizedWorkflowStepInput,
  stepId: string,
  nextStepId: string,
  stepBlocks: Map<string, StepBlockDefinition>,
): WorkflowStep => {
  const skillId = normalizeLegacyAopDefaultSkillId(stepInput.skillId);
  const block = stepBlocks.get(skillId);
  if (!block) {
    throw new Error(`Unknown workflow step "${stepInput.skillId}"`);
  }
  return {
    id: stepId,
    type: block.type,
    promptTemplate: shouldInlineStepBlock(block)
      ? `${INLINE_TEMPLATE_PREFIX}${block.promptTemplate}`
      : block.promptTemplate,
    maxAttempts: stepInput.maxAttempts ?? block.defaults.maxAttempts,
    signals: block.signals,
    ...(stepInput.verifyCommands === undefined ? {} : { verifyCommands: stepInput.verifyCommands }),
    ...(stepInput.checkerStep ? { checkerStep: true } : {}),
    ...(stepInput.agent ? { agent: stepInput.agent } : {}),
    transitions:
      stepInput.transitions ?? buildGeneratedStepTransitions(block.signals, stepId, nextStepId),
  };
};

const buildGeneratedStepTransitions = (
  signals: SignalDefinition[],
  stepId: string,
  nextStepId: string,
): Transition[] => [
  ...signals.map((signal) => ({
    condition: signal.name,
    target: resolveGeneratedSignalTarget(signal.name, stepId, nextStepId),
  })),
  { condition: "success", target: nextStepId },
  { condition: "failure", target: "__blocked__" },
];

const buildWorkflowDefinitionForSave = (
  name: string,
  stepInputs: NormalizedWorkflowStepInput[],
  stepBlocks: Map<string, StepBlockDefinition>,
  sourceDefinition?: WorkflowDefinition,
  canvas?: WorkflowCanvas,
): WorkflowDefinition => {
  const workflowStepIds = resolveWorkflowStepIds(stepInputs);
  if (sourceDefinition && shouldPatchExistingWorkflow(sourceDefinition, workflowStepIds)) {
    return patchExistingWorkflowDefinition(
      name,
      sourceDefinition,
      stepInputs,
      workflowStepIds,
      canvas,
    );
  }

  const definition = buildWorkflowDefinitionFromSteps(name, stepInputs, stepBlocks);
  return canvas ? { ...definition, canvas } : definition;
};

const shouldPatchExistingWorkflow = (
  definition: WorkflowDefinition,
  workflowStepIds: string[],
): boolean => {
  const existingStepIds = Object.values(definition.steps).map((step) => step.id);
  return (
    existingStepIds.length === workflowStepIds.length &&
    existingStepIds.every((stepId, index) => stepId === workflowStepIds[index])
  );
};

const patchExistingWorkflowDefinition = (
  name: string,
  definition: WorkflowDefinition,
  stepInputs: NormalizedWorkflowStepInput[],
  workflowStepIds: string[],
  canvas?: WorkflowCanvas,
): WorkflowDefinition => {
  const steps = { ...definition.steps };

  stepInputs.forEach((stepInput, index) => {
    const stepId = workflowStepIds[index];
    if (!stepId) return;

    const existingStep = definition.steps[stepId];
    if (!existingStep) return;

    steps[stepId] = buildPatchedWorkflowStep(existingStep, stepInput);
  });

  return {
    ...definition,
    name,
    steps,
    terminalStates: mergeTerminalStates(definition.terminalStates),
    ...(canvas ? { canvas } : {}),
  };
};

const buildPatchedWorkflowStep = (
  existingStep: WorkflowStep,
  stepInput: NormalizedWorkflowStepInput,
): WorkflowStep => {
  const nextStep: WorkflowStep = {
    ...existingStep,
    maxAttempts: stepInput.maxAttempts ?? existingStep.maxAttempts,
    transitions: stepInput.transitions ?? existingStep.transitions,
    ...(stepInput.verifyCommands === undefined ? {} : { verifyCommands: stepInput.verifyCommands }),
    ...(stepInput.checkerStep === undefined ? {} : { checkerStep: stepInput.checkerStep }),
    ...(stepInput.agent ? { agent: stepInput.agent } : {}),
  };

  return nextStep;
};

const mergeTerminalStates = (terminalStates: string[]): string[] => [
  ...new Set([...terminalStates, ...STANDARD_TERMINAL_STATES]),
];

const resolveWorkflowStepIds = (stepInputs: NormalizedWorkflowStepInput[]): string[] => {
  const usedIds = new Set<string>();

  return stepInputs.map((stepInput) => {
    const baseId = stepInput.id ?? stepInput.skillId;
    let candidate = baseId;
    let suffix = 2;

    while (usedIds.has(candidate)) {
      candidate = `${baseId}_${suffix}`;
      suffix += 1;
    }

    usedIds.add(candidate);
    return candidate;
  });
};

const resolveGeneratedSignalTarget = (
  signalName: string,
  currentStepId: string,
  nextStepId: string,
): string => {
  if (signalName === "CHUNK_DONE") {
    return currentStepId;
  }

  if (signalName === "REQUIRES_INPUT") {
    return "__paused__";
  }

  if (/(FAIL|FAILED|NEEDS_)/.test(signalName)) {
    return "__blocked__";
  }

  return nextStepId;
};

type WorkflowConnectionHandle =
  | "top-left"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom-left"
  | "left"
  | "top"
  | "bottom";

const WORKFLOW_CONNECTION_HANDLES = new Set<WorkflowConnectionHandle>([
  "top-left",
  "top-right",
  "right",
  "bottom-right",
  "bottom-left",
  "left",
  "top",
  "bottom",
]);

const normalizeWorkflowConnectionHandle = (
  handle: string | undefined,
): WorkflowConnectionHandle | undefined => {
  if (!handle || !WORKFLOW_CONNECTION_HANDLES.has(handle as WorkflowConnectionHandle)) {
    return undefined;
  }

  return handle as WorkflowConnectionHandle;
};

const parseWorkflowCanvasNodes = (
  nodes: NonNullable<CreateWorkflowInput["canvas"]>["nodes"],
): WorkflowCanvas["nodes"] => {
  const parsed: WorkflowCanvas["nodes"] = {};
  for (const [nodeId, position] of Object.entries(nodes)) {
    if (typeof position?.x !== "number" || typeof position?.y !== "number") {
      continue;
    }
    parsed[nodeId] = { x: position.x, y: position.y };
  }

  return parsed;
};

const parseWorkflowCanvasEdges = (
  edges: NonNullable<CreateWorkflowInput["canvas"]>["edges"],
): NonNullable<WorkflowCanvas["edges"]> => {
  const parsed: NonNullable<WorkflowCanvas["edges"]> = {};
  if (!edges) {
    return parsed;
  }

  for (const [edgeId, connection] of Object.entries(edges)) {
    const sourceHandle = normalizeWorkflowConnectionHandle(connection?.sourceHandle);
    const targetHandle = normalizeWorkflowConnectionHandle(connection?.targetHandle);
    if (!sourceHandle && !targetHandle) {
      continue;
    }

    parsed[edgeId] = {
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {}),
    };
  }

  return parsed;
};

const assertWorkflowCanvas = (
  canvas: CreateWorkflowInput["canvas"],
): WorkflowCanvas | undefined => {
  if (!canvas?.nodes) {
    return undefined;
  }

  const nodes = parseWorkflowCanvasNodes(canvas.nodes);
  if (Object.keys(nodes).length === 0) {
    return undefined;
  }

  const edges = parseWorkflowCanvasEdges(canvas.edges);

  return {
    version: 1,
    nodes,
    ...(Object.keys(edges).length > 0 ? { edges } : {}),
  };
};

const assertCreateWorkflowInput = (
  input: CreateWorkflowInput,
): {
  name: string;
  sourceWorkflowId?: string;
  steps: NormalizedWorkflowStepInput[];
  canvas?: WorkflowCanvas;
} => {
  const name = normalizeWorkflowName(input.name);
  if (!WORKFLOW_NAME_RE.test(name)) {
    throw new Error(
      "Workflow name must be 2-64 characters using lowercase letters, numbers, hyphens, or underscores",
    );
  }

  const rawSteps: CreateWorkflowStepInput[] =
    input.steps ??
    input.stepIds?.map(
      (skillId): CreateWorkflowStepInput => ({
        skillId,
      }),
    ) ??
    [];

  if (rawSteps.length === 0) {
    throw new Error("Select at least one workflow step");
  }

  const steps = rawSteps.map((step) => {
    const normalizedStep = {
      id: step.id ? assertStepId(step.id, "Workflow step id") : undefined,
      skillId: assertStepId(step.skillId, "Workflow step"),
      maxAttempts: step.maxAttempts === undefined ? undefined : assertMaxAttempts(step.maxAttempts),
      transitions: step.transitions?.map(assertWorkflowTransition),
      agent: step.agent ? assertStepAgent(step.agent) : undefined,
      verifyCommands: assertSafeVerifyCommands(step.verifyCommands),
      checkerStep: step.checkerStep === true ? true : undefined,
    };

    return normalizedStep;
  });

  return {
    name,
    sourceWorkflowId: normalizeOptionalWorkflowId(input.sourceWorkflowId),
    steps,
    canvas: assertWorkflowCanvas(input.canvas),
  };
};

const assertWorkflowTransition = (transition: CreateWorkflowTransitionInput): Transition => {
  const condition = transition.condition.trim();
  const target = transition.target.trim();

  if (!condition) {
    throw new Error("Workflow route condition is required");
  }

  if (!target) {
    throw new Error("Workflow route target is required");
  }

  const parsed = TransitionSchema.safeParse({
    condition,
    target,
    ...(transition.maxIterations === undefined ? {} : { maxIterations: transition.maxIterations }),
    ...(transition.onMaxIterations?.trim()
      ? { onMaxIterations: transition.onMaxIterations.trim() }
      : {}),
    ...(transition.afterIteration === undefined
      ? {}
      : { afterIteration: transition.afterIteration }),
    ...(transition.thenTarget?.trim() ? { thenTarget: transition.thenTarget.trim() } : {}),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid workflow route");
  }

  return parsed.data;
};

const assertCreateSkillBlockInput = (input: CreateSkillBlockInput): StepBlockDefinition => {
  const id = assertStepId(input.id, "Step block id");
  const type = input.type;
  const category = input.category;
  if (!STEP_TYPES.includes(type)) {
    throw new Error(`Unsupported step block type "${type}"`);
  }

  if (!STEP_CATEGORIES.includes(category)) {
    throw new Error(`Unsupported step block category "${category}"`);
  }

  if (STEP_LIBRARY.some((block) => block.id === id)) {
    throw new Error(`Built-in step block "${id}" cannot be overwritten`);
  }

  const description = input.description.trim();
  if (!description) {
    throw new Error("Step block description is required");
  }

  const promptTemplate = input.promptTemplate.trim();
  if (!promptTemplate) {
    throw new Error("Step block prompt is required");
  }

  const signals = input.signals.map(assertSignalDefinition);
  if (signals.length === 0) {
    throw new Error("Add at least one step block signal");
  }

  return {
    id,
    type,
    category,
    description,
    signals,
    promptTemplate,
    defaults: { maxAttempts: assertMaxAttempts(input.defaults.maxAttempts) },
    source: "user",
  };
};

const assertStepId = (value: string, fieldName: string): string => {
  const id = normalizeStepId(value);
  if (!STEP_ID_RE.test(id)) {
    throw new Error(`${fieldName} must be 2-64 characters using lowercase ids`);
  }

  return id;
};

const assertSignalDefinition = (signal: SignalDefinition): SignalDefinition => {
  const name = signal.name.trim().toUpperCase();
  const description = signal.description.trim();

  if (!SIGNAL_NAME_RE.test(name)) {
    throw new Error("Signal names must be uppercase ids");
  }

  if (!description) {
    throw new Error("Signal description is required");
  }

  return { name, description };
};

const assertMaxAttempts = (value: number): number => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ATTEMPTS_LIMIT) {
    throw new Error(`Retries must be between 1 and ${MAX_ATTEMPTS_LIMIT}`);
  }

  return value;
};

const assertStepAgent = (agent: StepAgent): StepAgent => {
  const parsed = StepAgentSchema.safeParse(agent);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid workflow step runtime");
  }

  const message = validateWorkflowRuntimeAgent(parsed.data);
  if (message) {
    throw new Error(message);
  }

  return parsed.data;
};

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toStoredSkillBlock = (block: StepBlockDefinition) => ({
  id: block.id,
  type: block.type,
  category: block.category,
  description: block.description,
  signals: JSON.stringify(block.signals),
  prompt_template: block.promptTemplate,
  defaults: JSON.stringify(block.defaults),
  agent: null,
  source: "user" as const,
});

const toStepBlockDefinition = (record: {
  id: string;
  type: string;
  category: string;
  description: string;
  signals: string;
  prompt_template: string;
  defaults: string;
  agent: string | null;
}): StepBlockDefinition => ({
  id: record.id,
  type: record.type as StepType,
  category: record.category as StepBlockDefinition["category"],
  description: record.description,
  signals: parseJson<SignalDefinition[]>(record.signals, []),
  promptTemplate: record.prompt_template,
  defaults: parseJson<{ maxAttempts: number }>(record.defaults, { maxAttempts: 1 }),
  source: "user",
});

const createStepBlockMap = (blocks: StepBlockDefinition[]): Map<string, StepBlockDefinition> =>
  new Map(blocks.map((block) => [block.id, block]));

const createWorkflowStepBlockMap = (
  blocks: StepBlockDefinition[],
  sourceDefinition?: WorkflowDefinition,
): Map<string, StepBlockDefinition> => {
  const stepBlocks = createStepBlockMap(blocks);
  if (!sourceDefinition) {
    return stepBlocks;
  }

  for (const step of Object.values(sourceDefinition.steps)) {
    if (stepBlocks.has(step.id)) {
      continue;
    }

    stepBlocks.set(step.id, {
      id: step.id,
      type: step.type,
      category: "general",
      description: `Existing ${step.type} workflow step`,
      signals: step.signals ?? [],
      promptTemplate: step.promptTemplate,
      defaults: { maxAttempts: step.maxAttempts },
      ...(step.agent ? { agent: step.agent } : {}),
      source: "builtin",
    });
  }

  return stepBlocks;
};

const shouldInlineStepBlock = (block: StepBlockDefinition): boolean =>
  block.source === "user" || block.source === "local";

const mergeStepLibraryBlocks = (blocks: StepBlockDefinition[]): StepBlockDefinition[] => {
  const merged = new Map<string, StepBlockDefinition>();

  for (const block of blocks) {
    if (!merged.has(block.id)) {
      merged.set(block.id, block);
    }
  }

  return [...merged.values()];
};

const withPromptContent = async (
  block: StepBlockDefinition,
  templateLoader: ReturnType<typeof createTemplateLoader>,
): Promise<StepBlockDefinition> => ({
  ...block,
  promptContent: shouldInlineStepBlock(block)
    ? block.promptTemplate
    : await templateLoader.load(block.promptTemplate),
});

export const createLocalWorkflowService = (ctx: LocalServerContext): LocalWorkflowService => {
  const templateLoader = createTemplateLoader();
  const stepCommandGenerator = createStepCommandGenerator(templateLoader);
  let syncPromise: Promise<void> | null = null;

  const ensureWorkflowsSynced = async (): Promise<void> => {
    if (!syncPromise) {
      syncPromise = (async () => {
        // The legacy built-in workflow catalog (aop-default-gpt, aop-default-claude,
        // landing-page) is retired: syncing an empty list deactivates any built-in
        // rows still present from older installs so only user workflows remain.
        await syncWorkflows(ctx.workflowRepository, []);
      })();
    }

    await syncPromise;
  };

  const listPersistedWorkflowNames = async (): Promise<string[]> => {
    await ensureWorkflowsSynced();
    return ctx.workflowRepository.listNames();
  };

  const listPersistedWorkflowDetails = async (): Promise<WorkflowSummary[]> => {
    await ensureWorkflowsSynced();
    const workflows = await ctx.workflowRepository.listActive();
    return workflows.map(summarizeWorkflow);
  };

  const listPersistedStepLibrary = async (): Promise<StepBlockDefinition[]> => {
    const customBlocks = (await ctx.workflowSkillBlockRepository.list()).filter(
      (block) => normalizeLegacyAopDefaultSkillId(block.id) === block.id,
    );
    const blocks = mergeStepLibraryBlocks([
      ...STEP_LIBRARY.map((block) => ({ ...block, source: "builtin" as const })),
      ...customBlocks.map(toStepBlockDefinition),
    ]);
    return Promise.all(blocks.map((block) => withPromptContent(block, templateLoader)));
  };

  const getAssignedWorkerWorkflowName = async (task: Task): Promise<string | null> => {
    const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(task.id);
    if (!assignment) {
      return null;
    }

    const agent = await ctx.agentRepository.getById(assignment.agent_id);
    if (agent?.status !== "active") {
      return null;
    }

    const workflow =
      (await ctx.workflowRepository.findById(agent.workflow_id)) ??
      (await ctx.workflowRepository.findByName(agent.workflow_id));
    return workflow?.name ?? agent.workflow_id;
  };

  const resolveWorkflowName = async (task: Task): Promise<string> => {
    if (task.preferred_workflow) {
      return task.preferred_workflow;
    }

    const assignedWorkflow = await getAssignedWorkerWorkflowName(task);
    if (!assignedWorkflow) {
      throw new Error(`Task ${task.id} has no assigned worker with a workflow`);
    }

    return assignedWorkflow;
  };

  const getWorkflow = async (workflowReference: string): Promise<WorkflowDefinition> => {
    await ensureWorkflowsSynced();
    const workflow =
      (await ctx.workflowRepository.findByName(workflowReference)) ??
      (await ctx.workflowRepository.findById(workflowReference));
    if (!workflow?.active) {
      throw new Error(`Workflow "${workflowReference}" not found`);
    }

    return migrateAopDefaultWorkflowDefinition(parseWorkflow(workflow.definition));
  };

  const resolveRetryStep = async (
    taskId: string,
    workflow: WorkflowDefinition,
    retryFromStep: string,
  ): Promise<{ step: WorkflowStep; visitedSteps: string[]; iteration: number }> => {
    const stateMachine = createWorkflowStateMachine(workflow);
    const retryStepId = normalizeRetryStepId(workflow, retryFromStep);
    const step = stateMachine.getStep(retryStepId);
    if (!step) {
      throw new Error(`Step "${retryFromStep}" not found in workflow "${workflow.name}"`);
    }

    const latestExecution = await ctx.executionRepository.getLatestExecutionByTaskId(taskId);
    if (!latestExecution || shouldResetRetryPath(latestExecution, workflow.name)) {
      return { step, visitedSteps: [retryStepId], iteration: 0 };
    }

    const previousVisited = normalizeVisitedSteps(
      parseVisitedSteps(latestExecution.visited_steps),
      workflow,
      stateMachine,
    );

    return {
      step,
      visitedSteps: buildRetryVisitedSteps(retryStepId, previousVisited),
      iteration: latestExecution.iteration ?? 0,
    };
  };

  const createRunningStep = async (
    executionId: string,
    step: WorkflowStep,
    iteration: number,
    resumeSessionId?: string | null,
  ) => {
    const stepExecutionId = generateTypeId("step");
    const stepCommand = await stepCommandGenerator.generate(step, stepExecutionId, 1, iteration);
    if (resumeSessionId) {
      stepCommand.resumeSessionId = resumeSessionId;
    }
    const now = new Date().toISOString();

    await ctx.executionRepository.createStepExecution({
      id: stepExecutionId,
      execution_id: executionId,
      step_id: step.id,
      step_type: step.type,
      status: "running",
      started_at: now,
      attempt: 1,
      iteration,
      signals_json: JSON.stringify(stepCommand.signals ?? []),
    });

    return stepCommand;
  };

  const isFinalizedStepStatus = (status: string): boolean =>
    status === "success" || status === "failure" || status === "awaiting_input";

  const getExistingTaskStatus = async (taskId: string): Promise<StepCompleteResponse> => {
    const latestTask = await ctx.taskRepository.get(taskId);
    return { taskStatus: latestTask?.status ?? "WORKING", step: null };
  };

  const loadExecutionContext = async (executionId: string): Promise<LoadedExecutionContext> => {
    const execution = await ctx.executionRepository.getExecution(executionId);
    if (!execution) {
      throw new Error(`Execution "${executionId}" not found`);
    }

    const workflow = await getWorkflow(execution.workflow_id);
    const stateMachine = createWorkflowStateMachine(workflow);
    const visitedSteps = parseVisitedSteps(execution.visited_steps);
    const currentStepId = visitedSteps.at(-1);
    if (!currentStepId) {
      throw new Error(`Execution "${executionId}" has no current step`);
    }

    return {
      execution,
      workflow,
      stateMachine,
      iteration: execution.iteration ?? 0,
      visitedSteps,
      currentStepId,
    };
  };

  const updateCompletedStep = async (
    input: CompleteStepInput,
    stepStatus: "success" | "failure" | "awaiting_input",
    pauseContext?: string,
    resolvedSignal?: string,
  ): Promise<void> => {
    await ctx.executionRepository.updateStepExecution(input.stepId, {
      status: stepStatus,
      signal: resolvedSignal ?? input.signal ?? null,
      pause_context: pauseContext ?? null,
      ended_at: new Date().toISOString(),
    });
  };

  const completeAsDone = async (
    task: Task,
    executionId: string,
    stepExecutionId: string,
    retryFromStep: string,
    workflow: WorkflowDefinition,
    assistantOutput?: string,
  ): Promise<StepCompleteResponse> => {
    const checkerGuard = await validateCheckerEvidence(executionId, workflow);
    if (!checkerGuard.ok) {
      await recordCheckerEvidenceFailure(
        task,
        executionId,
        stepExecutionId,
        retryFromStep,
        checkerGuard.message,
      );
      return completeAsBlocked(task.id, executionId, {
        code: "checker_evidence_missing",
        message: checkerGuard.message,
      });
    }

    await markGeneratedCompletionCriterionChecked(ctx, task);
    const guard = await validateTaskCompletion(ctx, task);
    if (!guard.ok) {
      await recordCompletionGuardFailure(
        task,
        executionId,
        stepExecutionId,
        retryFromStep,
        guard.message,
        guard.reasons,
      );
      return completeAsBlocked(task.id, executionId, {
        code: "completion_guard_failed",
        message: guard.message,
      });
    }

    await ctx.executionRepository.updateExecution(executionId, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    await recordCompletionSignals(task, executionId, assistantOutput);
    await ctx.taskRepository.update(task.id, { status: "DONE", preferred_workflow: null });
    return { taskStatus: "DONE", step: null };
  };

  const validateCheckerEvidence = async (
    executionId: string,
    workflow: WorkflowDefinition,
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    const checkerStepIds = new Set(
      Object.values(workflow.steps)
        .filter((step) => step.checkerStep === true)
        .map((step) => step.id),
    );
    if (checkerStepIds.size === 0) return { ok: true };

    const checkerStepExecutionIds = new Set(
      (await ctx.executionRepository.getStepExecutionsByExecutionId(executionId))
        .filter((step) => step.step_id !== null && checkerStepIds.has(step.step_id))
        .map((step) => step.id),
    );
    const hasPassedCheckerEvidence = (
      await ctx.runtimeEventRepository.listByExecutionId(executionId)
    )
      .filter((event) => event.kind === "verification_evidence_recorded")
      .some(
        (event) =>
          event.stepExecutionId !== null &&
          checkerStepExecutionIds.has(event.stepExecutionId) &&
          hasPassedEvidenceMetadata(event.metadata),
      );

    if (hasPassedCheckerEvidence) return { ok: true };
    return { ok: false, message: "Checker step completed without passed verification evidence" };
  };

  const hasPassedEvidenceMetadata = (metadata: Record<string, unknown> | undefined): boolean => {
    const evidence = metadata?.evidence;
    return (
      typeof evidence === "object" &&
      evidence !== null &&
      !Array.isArray(evidence) &&
      "status" in evidence &&
      evidence.status === "passed"
    );
  };

  const recordCompletionGuardFailure = async (
    task: Task,
    executionId: string,
    stepExecutionId: string,
    retryFromStep: string,
    message: string,
    reasons: string[],
  ): Promise<void> => {
    const now = new Date().toISOString();
    await ctx.runtimeEventRepository.insertMany([
      {
        id: randomUUID(),
        task_id: task.id,
        execution_id: executionId,
        step_execution_id: stepExecutionId,
        session_id: null,
        agent_id: null,
        kind: "task_blocked",
        title: `Completion guard blocked ${task.id}`,
        message,
        tool_name: null,
        status: "blocked",
        source_kind: "workflow",
        source_id: `${executionId}:completion_guard`,
        source_index: 0,
        occurred_at: now,
        metadata_json: JSON.stringify({
          code: "completion_guard_failed",
          retryFromStep,
          reasons,
        }),
      },
    ]);
    await createBlockerSignal(task, executionId, {
      title: `Completion guard blocked ${task.id}`,
      body: [message, ...reasons.map((reason) => `- ${reason}`)].join("\n"),
      kind: "regression",
      confidence: "high",
    });
  };

  const recordCheckerEvidenceFailure = async (
    task: Task,
    executionId: string,
    stepExecutionId: string,
    retryFromStep: string,
    message: string,
  ): Promise<void> => {
    const now = new Date().toISOString();
    await ctx.runtimeEventRepository.insertMany([
      {
        id: randomUUID(),
        task_id: task.id,
        execution_id: executionId,
        step_execution_id: stepExecutionId,
        session_id: null,
        agent_id: null,
        kind: "task_blocked",
        title: "Checker evidence blocked DONE",
        message,
        tool_name: null,
        status: "blocked",
        source_kind: "workflow",
        source_id: `${executionId}:checker_evidence`,
        source_index: 0,
        occurred_at: now,
        metadata_json: JSON.stringify({ code: "checker_evidence_missing", retryFromStep }),
      },
    ]);
    await createBlockerSignal(task, executionId, {
      title: `Checker evidence missing for ${task.id}`,
      body: message,
      kind: "follow-up",
      confidence: "high",
    });
  };

  const recordBudgetExceeded = async (
    task: Task,
    executionId: string,
    stepExecutionId: string,
    message: string,
    retryFromStep: string,
  ): Promise<void> => {
    const now = new Date().toISOString();
    await ctx.runtimeEventRepository.insertMany([
      {
        id: randomUUID(),
        task_id: task.id,
        execution_id: executionId,
        step_execution_id: stepExecutionId,
        session_id: null,
        agent_id: null,
        kind: "task_blocked",
        title: "Budget exceeded",
        message,
        tool_name: null,
        status: "blocked",
        source_kind: "workflow",
        source_id: `${executionId}:budget_exceeded`,
        source_index: 0,
        occurred_at: now,
        metadata_json: JSON.stringify({ code: "budget_exceeded", retryFromStep }),
      },
    ]);
    await createBlockerSignal(task, executionId, {
      title: `Budget blocked ${task.id}`,
      body: message,
      kind: "follow-up",
      confidence: "high",
    });
  };

  const recordMissingRequiredSignal = async (
    task: Task,
    executionId: string,
    stepExecutionId: string,
    stepId: string,
    expectedSignals: string[],
    message: string,
  ): Promise<void> => {
    const now = new Date().toISOString();
    const results = await Promise.allSettled([
      ctx.runtimeEventRepository.insertMany([
        {
          id: randomUUID(),
          task_id: task.id,
          execution_id: executionId,
          step_execution_id: stepExecutionId,
          session_id: null,
          agent_id: null,
          kind: "task_blocked",
          title: `Required workflow signal missing from ${stepId}`,
          message,
          tool_name: null,
          status: "blocked",
          source_kind: "workflow",
          source_id: `${executionId}:missing_required_signal:${stepExecutionId}`,
          source_index: 0,
          occurred_at: now,
          metadata_json: JSON.stringify({
            code: "missing_required_signal",
            stepId,
            retryFromStep: stepId,
            expectedSignals,
          }),
        },
      ]),
      createBlockerSignal(task, executionId, {
        title: `Required workflow signal missing for ${task.id}`,
        body: message,
        kind: "regression",
        confidence: "high",
      }),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn("Failed to record missing required signal diagnostic: {error}", {
          error: String(result.reason),
        });
      }
    }
  };

  const createBlockerSignal = async (
    task: Task,
    executionId: string,
    input: {
      title: string;
      body: string;
      kind: "follow-up" | "regression";
      confidence: "medium" | "high";
    },
  ): Promise<void> => {
    await createSignal(ctx, {
      repoId: task.repo_id,
      sourceTaskId: task.id,
      sourceExecutionId: executionId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      provenance: "aop",
      confidence: input.confidence,
    });
  };

  const recordCompletionSignals = async (
    task: Task,
    executionId: string,
    assistantOutput?: string,
  ): Promise<void> => {
    if (!assistantOutput?.trim()) return;

    await createSignalsFromAgentOutput(ctx, {
      repoId: task.repo_id,
      sourceTaskId: task.id,
      sourceExecutionId: executionId,
      output: assistantOutput,
    });
  };

  const completeAsPaused = async (taskId: string): Promise<StepCompleteResponse> => {
    await ctx.taskRepository.update(taskId, { status: "PAUSED" });
    return { taskStatus: "PAUSED", step: null };
  };

  const completeAsDraft = async (
    taskId: string,
    executionId: string,
  ): Promise<StepCompleteResponse> => {
    await ctx.executionRepository.updateExecution(executionId, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    await ctx.taskRepository.update(taskId, {
      status: "DRAFT",
      ready_at: null,
      retry_from_step: null,
      resume_input: null,
      worktree_path: null,
    });
    return { taskStatus: "DRAFT", step: null };
  };

  const completeAsBlocked = async (
    taskId: string,
    executionId: string,
    error: StepCompleteResponse["error"] = {
      code: "max_retries_exceeded",
      message: "Workflow blocked after step failure",
    },
  ): Promise<StepCompleteResponse> => {
    await ctx.executionRepository.updateExecution(executionId, {
      status: "failed",
      completed_at: new Date().toISOString(),
    });
    await ctx.taskRepository.update(taskId, { status: "BLOCKED" });
    return {
      taskStatus: "BLOCKED",
      step: null,
      error,
    };
  };

  const continueWorkflow = async (
    task: Task,
    input: CompleteStepInput,
    execution: Execution,
    workflowId: string,
    visitedSteps: string[],
    iteration: number,
    nextStepId: string,
    nextStep: WorkflowStep,
    shouldIncrementIteration: boolean | undefined,
  ): Promise<StepCompleteResponse> => {
    const nextVisitedSteps = buildVisitedSteps(visitedSteps, nextStepId);
    const nextIteration = shouldIncrementIteration ? iteration + 1 : iteration;

    await ctx.executionRepository.updateExecution(input.executionId, {
      visited_steps: JSON.stringify(nextVisitedSteps),
      iteration: nextIteration,
    });

    const nextCommand = await createRunningStep(input.executionId, nextStep, nextIteration);
    await ctx.taskRepository.update(task.id, { status: "WORKING" });

    return {
      taskStatus: "WORKING",
      execution: { id: execution.id, workflowId },
      step: nextCommand,
    };
  };

  const prepareStepCompletion = async (
    task: Task,
    input: CompleteStepInput,
  ): Promise<StepCompleteResponse | PendingStepCompletion> => {
    const stepExecution = await ctx.executionRepository.getStepExecution(input.stepId);
    if (!stepExecution) {
      throw new Error(`Step execution "${input.stepId}" not found`);
    }

    if (isFinalizedStepStatus(stepExecution.status)) {
      return getExistingTaskStatus(task.id);
    }

    const ctxState = await loadExecutionContext(input.executionId);
    const transition = ctxState.stateMachine.evaluateTransition(
      ctxState.currentStepId,
      { status: input.status, signal: input.signal },
      {
        iteration: ctxState.iteration,
        visitedSteps: ctxState.visitedSteps,
      } satisfies IterationContext,
    );

    if (transition.type === "paused") {
      await writeResumeContext(ctx, task, input, ctxState.currentStepId);
    }

    await updateCompletedStep(
      input,
      resolveCompletedStepStatus(transition, input.status),
      transition.type === "paused" ? input.pauseContext : undefined,
      input.signal,
    );

    return { ctxState, transition };
  };

  const handleTransitionResult = async (
    task: Task,
    input: CompleteStepInput,
    completion: PendingStepCompletion,
  ): Promise<StepCompleteResponse> => {
    const budgetGuard = await validateTaskBudget(ctx, task);
    if (!budgetGuard.ok) {
      await recordBudgetExceeded(
        task,
        input.executionId,
        input.stepId,
        budgetGuard.message,
        completion.ctxState.currentStepId,
      );
      return completeAsBlocked(task.id, input.executionId, {
        code: "budget_exceeded",
        message: budgetGuard.message,
      });
    }

    switch (completion.transition.type) {
      case "done":
        return completeAsDone(
          task,
          input.executionId,
          input.stepId,
          completion.ctxState.currentStepId,
          completion.ctxState.workflow,
          input.assistantOutput,
        );
      case "paused":
        return completeAsPaused(task.id);
      case "draft":
        return completeAsDraft(task.id, input.executionId);
      case "blocked": {
        if (completion.transition.reason === "missing_required_signal") {
          const expectedSignals = completion.transition.expectedSignals ?? [];
          const message = `Step "${completion.ctxState.currentStepId}" completed without a required workflow signal. Expected one of: ${expectedSignals.join(", ")}. Verification may still be running or the agent ended before reporting its result.`;
          const response = await completeAsBlocked(task.id, input.executionId, {
            code: "missing_required_signal",
            message,
          });
          await recordMissingRequiredSignal(
            task,
            input.executionId,
            input.stepId,
            completion.ctxState.currentStepId,
            expectedSignals,
            message,
          );
          return response;
        }

        await createBlockerSignal(task, input.executionId, {
          title: `Workflow blocked ${task.id}`,
          body: "Workflow reached the blocked terminal state.",
          kind: "regression",
          confidence: "medium",
        });
        return completeAsBlocked(task.id, input.executionId);
      }
      case "step":
        return continueWorkflow(
          task,
          input,
          completion.ctxState.execution,
          completion.ctxState.execution.workflow_id,
          completion.ctxState.visitedSteps,
          completion.ctxState.iteration,
          completion.transition.stepId,
          completion.transition.step,
          completion.transition.shouldIncrementIteration,
        );
      default:
        return assertUnreachable(completion.transition);
    }
  };

  return {
    listWorkflows: async () => {
      return listPersistedWorkflowNames();
    },

    listWorkflowDetails: async () => {
      return listPersistedWorkflowDetails();
    },

    listStepLibrary: async () => {
      return listPersistedStepLibrary();
    },

    createSkillBlock: async (input) => {
      const block = assertCreateSkillBlockInput(input);
      const canonicalId = normalizeLegacyAopDefaultSkillId(block.id);
      if (canonicalId !== block.id) {
        throw new Error(`Step block id "${block.id}" is retired; use "${canonicalId}"`);
      }
      const saved = await ctx.workflowSkillBlockRepository.upsert(toStoredSkillBlock(block));
      return withPromptContent(toStepBlockDefinition(saved), templateLoader);
    },

    deleteSkillBlock: async (id) => {
      const normalizedId = assertStepId(id, "Step block id");
      if (STEP_LIBRARY.some((block) => block.id === normalizedId)) {
        throw new Error(`Built-in step block "${normalizedId}" cannot be deleted`);
      }

      const deleted = await ctx.workflowSkillBlockRepository.delete(normalizedId);
      if (!deleted) {
        throw new Error(`Step block "${normalizedId}" not found`);
      }
    },

    deleteWorkflow: async (id) => {
      const workflow = await ctx.workflowRepository.findById(id);
      if (!workflow?.active) {
        throw new Error(`Workflow "${id}" not found`);
      }
      if (workflow.source === "builtin") {
        throw new Error(`Built-in workflow "${workflow.name}" cannot be deleted`);
      }

      await ctx.workflowRepository.deactivateByName(workflow.name);
    },

    createWorkflowFromSteps: async (input) => {
      await ensureWorkflowsSynced();
      const { name, sourceWorkflowId, steps, canvas } = assertCreateWorkflowInput(input);
      const existing = await ctx.workflowRepository.findByName(name);
      const sourceWorkflow = sourceWorkflowId
        ? await ctx.workflowRepository.findById(sourceWorkflowId)
        : existing;
      if (sourceWorkflowId && !sourceWorkflow) {
        throw new Error(`Source workflow "${sourceWorkflowId}" not found`);
      }

      const sourceDefinition = sourceWorkflow
        ? parseWorkflow(sourceWorkflow.definition)
        : undefined;
      const stepBlocks = createWorkflowStepBlockMap(
        await listPersistedStepLibrary(),
        sourceDefinition,
      );
      const definition = parseWorkflow(
        JSON.stringify(
          buildWorkflowDefinitionForSave(name, steps, stepBlocks, sourceDefinition, canvas),
        ),
      );
      const workflow = await ctx.workflowRepository.upsert({
        id: existing?.id ?? randomUUID(),
        name,
        definition: JSON.stringify(definition),
        source: "user",
      });

      return summarizeWorkflow(workflow);
    },

    startTask: async (task) => {
      const workflowName = await resolveWorkflowName(task);
      const workflow = await getWorkflow(workflowName);
      const stateMachine = createWorkflowStateMachine(workflow);

      const start = task.retry_from_step
        ? await resolveRetryStep(task.id, workflow, task.retry_from_step)
        : {
            step: stateMachine.getInitialStep(),
            visitedSteps: [stateMachine.getInitialStep().id],
            iteration: 0,
          };

      const executionId = generateTypeId("exec");
      const now = new Date().toISOString();
      await ctx.executionRepository.createExecution({
        id: executionId,
        task_id: task.id,
        workflow_id: workflow.name,
        status: "running",
        visited_steps: JSON.stringify(start.visitedSteps),
        iteration: start.iteration,
        started_at: now,
      });

      const stepCommand = await createRunningStep(executionId, start.step, start.iteration);

      logger.info("Started local workflow {workflow} for task {taskId}", {
        workflow: workflow.name,
        taskId: task.id,
        stepId: start.step.id,
      });

      return {
        status: "WORKING",
        execution: { id: executionId, workflowId: workflow.name },
        step: stepCommand,
      };
    },

    completeStep: async (task, input) => {
      const completion = await prepareStepCompletion(task, input);
      if ("taskStatus" in completion) {
        return completion;
      }
      return handleTransitionResult(task, input, completion);
    },

    resumeTask: async (task, stepId, input) => {
      const stepExecution = await ctx.executionRepository.getStepExecution(stepId);
      if (!stepExecution) {
        throw new Error(`Step execution "${stepId}" not found`);
      }
      if (stepExecution.status !== "awaiting_input") {
        throw new Error(`Step "${stepId}" is not awaiting input`);
      }

      const ctxState = await loadExecutionContext(stepExecution.execution_id);
      const currentStep = ctxState.stateMachine.getStep(ctxState.currentStepId);
      if (!currentStep) {
        throw new Error(`Step "${ctxState.currentStepId}" not found`);
      }

      const resumedCommand = await createRunningStep(
        stepExecution.execution_id,
        currentStep,
        ctxState.iteration,
        stepExecution.session_id,
      );
      resumedCommand.input = input;

      await ctx.taskRepository.update(task.id, {
        status: "WORKING",
        resume_input: null,
      });

      return {
        taskStatus: "WORKING",
        execution: {
          id: ctxState.execution.id,
          workflowId: ctxState.execution.workflow_id,
        },
        step: resumedCommand,
      };
    },
  };
};
