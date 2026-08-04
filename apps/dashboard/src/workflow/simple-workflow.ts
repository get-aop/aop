import type {
  WorkflowStepAgent,
  WorkflowStepProvider,
  WorkflowStepSaveInput,
  WorkflowSummary,
  WorkflowSummaryStep,
  WorkflowTransition,
} from "../api/client";

/**
 * The four-step recipe (PLAN §6.4): ordered steps from a catalog of four,
 * compiled to the existing saveWorkflow payload. Engine untouched.
 */

export type SimpleStepKind = "implement" | "code-review" | "test" | "browser";

export const SIMPLE_STEP_KINDS: readonly SimpleStepKind[] = [
  "implement",
  "code-review",
  "test",
  "browser",
];

export const SIMPLE_WORKFLOW_MAX_STEPS = 8;

/** Browser steps are only valid on runtimes that can drive a browser. */
export const BROWSER_STEP_PROVIDERS: readonly WorkflowStepProvider[] = ["claude-code", "codex-cli"];

export interface SimpleWorkflowStep {
  kind: SimpleStepKind;
  agent: WorkflowStepAgent;
}

export interface SimpleWorkflow {
  name: string;
  steps: SimpleWorkflowStep[];
}

const STEP_SKILL_IDS: Record<SimpleStepKind, string> = {
  implement: "implement",
  "code-review": "code_review",
  test: "run-tests",
  browser: "browser_control",
};

const STEP_PROMPT_TEMPLATES: Record<SimpleStepKind, string> = {
  implement: "implement.md.hbs",
  "code-review": "code-review-step.md.hbs",
  test: "run-tests.md.hbs",
  browser: "browser-control.md.hbs",
};

const HELPER_PROMPT_TEMPLATES = {
  debug: "debug-systematic.md.hbs",
  fix: "fix-issues.md.hbs",
} as const;

const TERMINAL_TARGET = "__done__";
const BLOCKED_TARGET = "__blocked__";

const REASONING_TIERS = ["low", "medium", "high", "extra-high", "max"] as const;

export class SimpleWorkflowError extends Error {}

/**
 * Compile the linear step list into the existing saveWorkflow steps payload:
 * ids {kind}-{i}; helpers get --debug/--fix suffixes; helper agents copy the
 * step's agent with reasoning bumped one tier (max stays max); failure
 * transitions loop through the helper with bounded iterations then block.
 */
export const compileSimpleWorkflow = (workflow: SimpleWorkflow): WorkflowStepSaveInput[] => {
  if (workflow.name.trim().length === 0) {
    throw new SimpleWorkflowError("Workflow name is required");
  }
  if (workflow.steps.length === 0) {
    throw new SimpleWorkflowError("A workflow needs at least one step");
  }
  if (workflow.steps.length > SIMPLE_WORKFLOW_MAX_STEPS) {
    throw new SimpleWorkflowError(`A workflow can have at most ${SIMPLE_WORKFLOW_MAX_STEPS} steps`);
  }

  return workflow.steps.flatMap((step, index) =>
    compileStep(step, index, workflow.steps[index + 1]?.kind ?? null),
  );
};

const HELPER_SKILL_IDS = {
  debug: "debug-failures",
  fix: "fix-issues",
} as const;

const stripHelperKind = (transition: FailureTransition): WorkflowTransition => {
  const { kind: _kind, ...rest } = transition;
  return rest;
};

const successConditionFor = (kind: SimpleStepKind): string => {
  switch (kind) {
    case "implement":
      return "success";
    case "code-review":
      return "REVIEW_PASSED";
    case "test":
      return "TESTS_PASS";
    case "browser":
      return "BROWSER_TASK_COMPLETE";
  }
};

interface FailureTransition extends WorkflowTransition {
  kind: "debug" | "fix";
}

const failureTransitionFor = (
  kind: SimpleStepKind,
  id: string,
  _next: string,
): FailureTransition | null => {
  switch (kind) {
    case "implement":
      return {
        condition: "failure",
        target: `${id}--debug`,
        maxIterations: 2,
        onMaxIterations: BLOCKED_TARGET,
        kind: "debug",
      };
    case "code-review":
      return {
        condition: "REVIEW_FAILED",
        target: `${id}--fix`,
        maxIterations: 2,
        onMaxIterations: BLOCKED_TARGET,
        kind: "fix",
      };
    case "test":
      return {
        condition: "TESTS_FAIL",
        target: `${id}--debug`,
        maxIterations: 5,
        onMaxIterations: BLOCKED_TARGET,
        kind: "debug",
      };
    case "browser":
      return {
        condition: "BROWSER_TASK_FAILED",
        target: `${id}--debug`,
        maxIterations: 2,
        onMaxIterations: BLOCKED_TARGET,
        kind: "debug",
      };
  }
};

/** One reasoning tier up: low → medium → high → extra-high → max (max stays max). */
export const bumpReasoning = (agent: WorkflowStepAgent): WorkflowStepAgent => {
  const current = REASONING_TIERS.indexOf(agent.reasoning as (typeof REASONING_TIERS)[number]);
  if (current < 0 || current >= REASONING_TIERS.length - 1) return { ...agent };
  return { ...agent, reasoning: REASONING_TIERS[current + 1]! };
};

const compileStep = (
  step: SimpleWorkflowStep,
  index: number,
  nextKind: SimpleStepKind | null,
): WorkflowStepSaveInput[] => {
  const id = `${step.kind}-${index + 1}`;
  const next = nextKind ? `${nextKind}-${index + 2}` : TERMINAL_TARGET;
  const agent = step.kind === "browser" ? { ...step.agent, browserControl: true } : step.agent;

  if (step.kind === "browser" && !BROWSER_STEP_PROVIDERS.includes(agent.provider)) {
    throw new SimpleWorkflowError(
      `Browser steps require a ${BROWSER_STEP_PROVIDERS.join(" or ")} provider`,
    );
  }

  const failure = failureTransitionFor(step.kind, id, next);
  const failureTransition = failure ? stripHelperKind(failure) : null;
  const steps: WorkflowStepSaveInput[] = [
    {
      id,
      skillId: STEP_SKILL_IDS[step.kind],
      agent,
      transitions: [
        { condition: successConditionFor(step.kind), target: next },
        ...(failureTransition ? [failureTransition] : []),
      ],
    },
  ];

  if (failure) {
    steps.push({
      id: failure.target,
      skillId: HELPER_SKILL_IDS[failure.kind],
      agent: bumpReasoning(agent),
      transitions: [{ condition: "FIX_COMPLETE", target: id }],
    });
  }
  return steps;
};

/**
 * Recognize compiled simple workflows from a summary. Anything that is not
 * exactly the generated shape (ids, prompt templates, transition shape)
 * reports as Legacy (null).
 */
export const decompileSimpleWorkflow = (workflow: WorkflowSummary): SimpleWorkflow | null => {
  const name = workflow.name.trim();
  if (!name || workflow.steps.length === 0) return null;

  const steps: SimpleWorkflowStep[] = [];
  let index = 0;
  while (index < workflow.steps.length) {
    const step = decompileStep(workflow, index);
    if (!step) return null;
    steps.push(step);
    index += 2;
  }

  return { name, steps };
};

const validFailureTransition = (step: WorkflowSummaryStep): WorkflowTransition | null => {
  const failure = step.transitions.find((t) =>
    ["failure", "REVIEW_FAILED", "TESTS_FAIL", "BROWSER_TASK_FAILED"].includes(t.condition),
  );
  if (!failure) return null;
  if (failure.target !== `${step.id}--debug` && failure.target !== `${step.id}--fix`) {
    return null;
  }
  if (failure.onMaxIterations !== BLOCKED_TARGET) return null;
  return failure;
};

const decompileStep = (workflow: WorkflowSummary, index: number): SimpleWorkflowStep | null => {
  const step = workflow.steps[index];
  if (!step) return null;
  const kind = kindForIdAndTemplate(step);
  if (!kind) return null;
  const stepIndex = Math.floor(index / 2) + 1;
  if (step.id !== `${kind}-${stepIndex}`) return null;

  const success = step.transitions.find((t) => t.condition === successConditionFor(kind));
  const failure = validFailureTransition(step);
  if (!success || !failure) return null;

  if (!matchesHelper(workflow, index, step.id)) return null;

  const next = workflow.steps[index + 2];
  const expectedNext = next?.id ?? TERMINAL_TARGET;
  if (success.target !== expectedNext) return null;

  return {
    kind,
    agent: { ...step.agent!, browserControl: step.agent?.browserControl ?? false },
  };
};

const matchesHelper = (workflow: WorkflowSummary, index: number, parentId: string): boolean => {
  const failure = validFailureTransition(workflow.steps[index]!);
  if (!failure) return false;
  const helperKind = failure.target.endsWith("--debug") ? "debug" : "fix";
  const helper = workflow.steps[index + 1];
  if (!helper || helper.id !== failure.target) return false;
  if (helper.promptTemplate !== HELPER_PROMPT_TEMPLATES[helperKind]) return false;
  if (helper.transitions.length !== 1) return false;
  const fixComplete = helper.transitions[0];
  if (!fixComplete || fixComplete.condition !== "FIX_COMPLETE") return false;
  if (fixComplete.target !== parentId) return false;
  return fixComplete.maxIterations === undefined;
};

const kindForIdAndTemplate = (step: {
  id: string;
  promptTemplate: string;
}): SimpleStepKind | null => {
  for (const kind of SIMPLE_STEP_KINDS) {
    if (step.promptTemplate === STEP_PROMPT_TEMPLATES[kind]) return kind;
  }
  return null;
};
