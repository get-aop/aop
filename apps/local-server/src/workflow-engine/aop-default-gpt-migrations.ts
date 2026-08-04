import type { Transition, WorkflowCanvas, WorkflowDefinition, WorkflowStep } from "./types.ts";

/** Built-in aop-default-gpt implementation step block / workflow node id. */
export const AOP_DEFAULT_IMPLEMENT_STEP_ID = "implement";

/** Legacy id before rename (step block only — not the iterate step type). */
export const LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID = "iterate";

/** Simplification pass step id (renamed from cleanup-review). */
export const AOP_DEFAULT_SIMPLIFICATION_STEP_ID = "simplification";
export const LEGACY_AOP_DEFAULT_CLEANUP_STEP_ID = "cleanup-review";

/** Built-in aop-default-gpt final structural review step id. */
export const NUCLEAR_REVIEW_STEP_ID = "nuclear_review";

/** Retired two-axis review id shipped between v0.7.x and v0.8.4. */
const LEGACY_TWO_AXIS_REVIEW_STEP_ID = "review";

const NUCLEAR_REVIEW_TEMPLATE = "nuclear-review.md.hbs";
const LEGACY_TWO_AXIS_REVIEW_TEMPLATE = "review.md.hbs";
const SIMPLIFICATION_TEMPLATE = "simplification.md.hbs";
const LEGACY_CLEANUP_TEMPLATE = "cleanup-review.md.hbs";

const AOP_DEFAULT_CODEX_MODEL = "gpt-5.5";
const AOP_DEFAULT_STEP_REASONING: Record<string, NonNullable<WorkflowStep["agent"]>["reasoning"]> =
  {
    "debug-failures": "extra-high",
    [AOP_DEFAULT_SIMPLIFICATION_STEP_ID]: "medium",
    [NUCLEAR_REVIEW_STEP_ID]: "extra-high",
    [LEGACY_TWO_AXIS_REVIEW_STEP_ID]: "extra-high",
    "quick-review": "extra-high",
  };
const LEGACY_AOP_DEFAULT_PLANNING_STEP_IDS = new Set([
  "planning_cli_plan",
  "human_in_loop",
  "lifecycle_mark_ready",
]);

const renameTransitionTargets = (
  transitions: WorkflowStep["transitions"],
): WorkflowStep["transitions"] =>
  transitions.map((transition) =>
    transition.target === LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID
      ? { ...transition, target: AOP_DEFAULT_IMPLEMENT_STEP_ID }
      : transition,
  );

const removeLegacyChunkTransitions = (transitions: WorkflowStep["transitions"]): Transition[] => {
  const nextTarget =
    transitions.find((transition) => transition.condition === "ALL_TASKS_DONE")?.target ??
    "__done__";
  return [
    { condition: "success", target: nextTarget },
    ...transitions.filter(
      (transition) =>
        transition.condition !== "CHUNK_DONE" &&
        transition.condition !== "ALL_TASKS_DONE" &&
        transition.condition !== "__none__",
    ),
  ];
};

const migrateCanvas = (canvas: WorkflowCanvas | undefined): WorkflowCanvas | undefined => {
  if (!canvas?.nodes[LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID]) {
    return canvas;
  }

  const { [LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID]: legacyPosition, ...rest } = canvas.nodes;
  return {
    version: canvas.version,
    nodes: {
      ...rest,
      ...(rest[AOP_DEFAULT_IMPLEMENT_STEP_ID]
        ? {}
        : { [AOP_DEFAULT_IMPLEMENT_STEP_ID]: legacyPosition }),
    },
  };
};

const removeCanvasNodes = (
  canvas: WorkflowCanvas | undefined,
  removedStepIds: Set<string>,
): WorkflowCanvas | undefined => {
  if (!canvas) {
    return undefined;
  }

  const nodes = Object.fromEntries(
    Object.entries(canvas.nodes).filter(([id]) => !removedStepIds.has(id)),
  );
  const edges = Object.fromEntries(
    Object.entries(canvas.edges ?? {}).filter(
      ([id]) => !id.split("::").some((part) => removedStepIds.has(part)),
    ),
  );

  return {
    version: canvas.version,
    nodes,
    ...(Object.keys(edges).length > 0 ? { edges } : {}),
  };
};

const migrateStepAgent = (id: string, step: WorkflowStep): WorkflowStep => {
  if (!step.agent) {
    return step;
  }

  if (step.agent.provider !== "opencode" && step.agent.provider !== "codex-cli") {
    return step;
  }

  return {
    ...step,
    agent: {
      ...step.agent,
      provider: "codex-cli",
      model: AOP_DEFAULT_CODEX_MODEL,
      reasoning: AOP_DEFAULT_STEP_REASONING[id] ?? step.agent.reasoning,
      fastMode: true,
    },
  };
};

const migrateStepAgents = (definition: WorkflowDefinition): WorkflowDefinition => {
  let changed = false;
  const steps = Object.fromEntries(
    Object.entries(definition.steps).map(([id, step]) => {
      const migrated = migrateStepAgent(id, step);
      if (migrated !== step) {
        changed = true;
      }
      return [id, migrated];
    }),
  ) as WorkflowDefinition["steps"];

  return changed ? { ...definition, steps } : definition;
};

const migrateLegacyImplementStep = (definition: WorkflowDefinition): WorkflowDefinition => {
  const legacyStep = definition.steps[LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID];
  if (!legacyStep) {
    return definition;
  }

  const { [LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID]: _removed, ...remainingSteps } = definition.steps;
  const implementStep: WorkflowStep = {
    ...legacyStep,
    id: AOP_DEFAULT_IMPLEMENT_STEP_ID,
    type: "implement",
    transitions: removeLegacyChunkTransitions(renameTransitionTargets(legacyStep.transitions)),
  };

  return {
    ...definition,
    initialStep:
      definition.initialStep === LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID
        ? AOP_DEFAULT_IMPLEMENT_STEP_ID
        : definition.initialStep,
    steps: {
      ...remainingSteps,
      [AOP_DEFAULT_IMPLEMENT_STEP_ID]: implementStep,
    },
    canvas: migrateCanvas(definition.canvas),
  };
};

const removeLegacyPlanningBridge = (definition: WorkflowDefinition): WorkflowDefinition => {
  if (!Object.keys(definition.steps).some((id) => LEGACY_AOP_DEFAULT_PLANNING_STEP_IDS.has(id))) {
    return definition;
  }

  const steps = Object.fromEntries(
    Object.entries(definition.steps)
      .filter(([id]) => !LEGACY_AOP_DEFAULT_PLANNING_STEP_IDS.has(id))
      .map(([id, step]) => [
        id,
        {
          ...step,
          transitions: step.transitions.filter(
            (transition) => !LEGACY_AOP_DEFAULT_PLANNING_STEP_IDS.has(transition.target),
          ),
        },
      ]),
  ) as WorkflowDefinition["steps"];

  return {
    ...definition,
    initialStep: LEGACY_AOP_DEFAULT_PLANNING_STEP_IDS.has(definition.initialStep)
      ? AOP_DEFAULT_IMPLEMENT_STEP_ID
      : definition.initialStep,
    steps,
    canvas: removeCanvasNodes(definition.canvas, LEGACY_AOP_DEFAULT_PLANNING_STEP_IDS),
  };
};

const renameCanvasStep = (
  canvas: WorkflowCanvas | undefined,
  from: string,
  to: string,
): WorkflowCanvas | undefined => {
  if (!canvas) {
    return undefined;
  }

  const nodes = Object.fromEntries(
    Object.entries(canvas.nodes).map(([id, position]) => [id === from ? to : id, position]),
  );
  const edges = canvas.edges
    ? Object.fromEntries(
        Object.entries(canvas.edges).map(([id, edge]) => [
          id
            .split("::")
            .map((part) => (part === from ? to : part))
            .join("::"),
          edge,
        ]),
      )
    : undefined;

  return { version: canvas.version, nodes, ...(edges ? { edges } : {}) };
};

const renameTransitionStep = (transition: Transition, from: string, to: string): Transition => ({
  ...transition,
  ...(transition.target === from ? { target: to } : {}),
  ...(transition.onMaxIterations === from ? { onMaxIterations: to } : {}),
  ...(transition.thenTarget === from ? { thenTarget: to } : {}),
});

/** Renames the saved cleanup-review step (and everything pointing at it) to simplification. */
const migrateCleanupReviewRename = (definition: WorkflowDefinition): WorkflowDefinition => {
  const legacyStep = definition.steps[LEGACY_AOP_DEFAULT_CLEANUP_STEP_ID];
  if (!legacyStep) {
    return definition;
  }

  const { [LEGACY_AOP_DEFAULT_CLEANUP_STEP_ID]: _removed, ...remainingSteps } = definition.steps;
  const renamedStep: WorkflowStep = {
    ...legacyStep,
    id: AOP_DEFAULT_SIMPLIFICATION_STEP_ID,
    promptTemplate:
      legacyStep.promptTemplate === LEGACY_CLEANUP_TEMPLATE
        ? SIMPLIFICATION_TEMPLATE
        : legacyStep.promptTemplate,
  };

  const steps = Object.fromEntries(
    Object.entries({
      ...remainingSteps,
      [AOP_DEFAULT_SIMPLIFICATION_STEP_ID]: renamedStep,
    }).map(([id, step]) => [
      id,
      {
        ...step,
        transitions: step.transitions.map((transition) =>
          renameTransitionStep(
            transition,
            LEGACY_AOP_DEFAULT_CLEANUP_STEP_ID,
            AOP_DEFAULT_SIMPLIFICATION_STEP_ID,
          ),
        ),
      },
    ]),
  ) as WorkflowDefinition["steps"];

  return {
    ...definition,
    initialStep:
      definition.initialStep === LEGACY_AOP_DEFAULT_CLEANUP_STEP_ID
        ? AOP_DEFAULT_SIMPLIFICATION_STEP_ID
        : definition.initialStep,
    steps,
    canvas: renameCanvasStep(
      definition.canvas,
      LEGACY_AOP_DEFAULT_CLEANUP_STEP_ID,
      AOP_DEFAULT_SIMPLIFICATION_STEP_ID,
    ),
  };
};

const NUCLEAR_REVIEW_STEP_TRANSITIONS: Transition[] = [
  { condition: "REVIEW_FAILED", target: "fix-issues" },
  { condition: "failure", target: "__blocked__" },
  { condition: "REVIEW_PASSED", target: "__done__" },
];

const SIMPLIFICATION_STEP_TRANSITIONS: Transition[] = [
  { condition: "failure", target: "__blocked__" },
  { condition: "CLEANUP_COMPLETE", target: NUCLEAR_REVIEW_STEP_ID },
];

const SIMPLIFICATION_CANVAS_POSITION = { x: -352.05030202168587, y: 406.7465524136999 };

const normalizeNuclearReviewPromptTemplate = (promptTemplate: string): string =>
  promptTemplate === LEGACY_TWO_AXIS_REVIEW_TEMPLATE || promptTemplate.startsWith("inline:")
    ? NUCLEAR_REVIEW_TEMPLATE
    : promptTemplate;

const restoreNuclearReviewCanvas = (
  canvas: WorkflowCanvas | undefined,
): WorkflowCanvas | undefined => {
  const renamed = renameCanvasStep(canvas, LEGACY_TWO_AXIS_REVIEW_STEP_ID, NUCLEAR_REVIEW_STEP_ID);
  if (!renamed) {
    return undefined;
  }

  const nodes = {
    ...renamed.nodes,
    ...(renamed.nodes[AOP_DEFAULT_SIMPLIFICATION_STEP_ID]
      ? {}
      : { [AOP_DEFAULT_SIMPLIFICATION_STEP_ID]: SIMPLIFICATION_CANVAS_POSITION }),
  };

  const edges = Object.fromEntries(
    Object.entries(renamed.edges ?? {}).map(([id, edge]) => {
      const [source, condition, target] = id.split("::");
      const entersReviewFromOutside =
        target === NUCLEAR_REVIEW_STEP_ID && source !== AOP_DEFAULT_SIMPLIFICATION_STEP_ID;
      return entersReviewFromOutside
        ? [[source, condition, AOP_DEFAULT_SIMPLIFICATION_STEP_ID].join("::"), edge]
        : [id, edge];
    }),
  );
  edges[`${AOP_DEFAULT_SIMPLIFICATION_STEP_ID}::CLEANUP_COMPLETE::${NUCLEAR_REVIEW_STEP_ID}`] ??= {
    sourceHandle: "bottom-left",
    targetHandle: "top-left",
  };
  edges[`${AOP_DEFAULT_SIMPLIFICATION_STEP_ID}::failure::__blocked__`] ??= {
    sourceHandle: "top-left",
    targetHandle: "left",
  };

  return { version: renamed.version, nodes, edges };
};

/** Splits saved two-axis review chains back into the simplification + nuclear_review pipeline. */
const restoreLegacyReviewPipeline = (definition: WorkflowDefinition): WorkflowDefinition => {
  const twoAxisStep = definition.steps[LEGACY_TWO_AXIS_REVIEW_STEP_ID];
  if (!twoAxisStep) {
    return definition;
  }

  const existingSimplification = definition.steps[AOP_DEFAULT_SIMPLIFICATION_STEP_ID];
  const steps = Object.fromEntries(
    Object.entries(definition.steps)
      .filter(
        ([id]) =>
          id !== LEGACY_TWO_AXIS_REVIEW_STEP_ID &&
          id !== NUCLEAR_REVIEW_STEP_ID &&
          id !== AOP_DEFAULT_SIMPLIFICATION_STEP_ID,
      )
      .map(([id, step]) => [
        id,
        {
          ...step,
          transitions: step.transitions.map((transition) =>
            renameTransitionStep(
              transition,
              LEGACY_TWO_AXIS_REVIEW_STEP_ID,
              AOP_DEFAULT_SIMPLIFICATION_STEP_ID,
            ),
          ),
        },
      ]),
  ) as WorkflowDefinition["steps"];

  steps[AOP_DEFAULT_SIMPLIFICATION_STEP_ID] = existingSimplification
    ? { ...existingSimplification, transitions: SIMPLIFICATION_STEP_TRANSITIONS }
    : {
        id: AOP_DEFAULT_SIMPLIFICATION_STEP_ID,
        type: "review",
        promptTemplate: SIMPLIFICATION_TEMPLATE,
        maxAttempts: 1,
        ...(twoAxisStep.agent ? { agent: { ...twoAxisStep.agent, reasoning: "medium" } } : {}),
        transitions: SIMPLIFICATION_STEP_TRANSITIONS,
        signals: [
          { name: "CLEANUP_COMPLETE", description: "cleanup and simplification pass completed" },
        ],
      };

  steps[NUCLEAR_REVIEW_STEP_ID] = {
    ...twoAxisStep,
    id: NUCLEAR_REVIEW_STEP_ID,
    promptTemplate: normalizeNuclearReviewPromptTemplate(twoAxisStep.promptTemplate),
    transitions: NUCLEAR_REVIEW_STEP_TRANSITIONS,
  };

  return {
    ...definition,
    initialStep:
      definition.initialStep === LEGACY_TWO_AXIS_REVIEW_STEP_ID
        ? AOP_DEFAULT_SIMPLIFICATION_STEP_ID
        : definition.initialStep,
    steps,
    canvas: restoreNuclearReviewCanvas(definition.canvas),
  };
};

/** Normalizes old saved aop-default-gpt definitions onto the current built-in runtime shape. */
export const migrateAopDefaultWorkflowDefinition = (
  definition: WorkflowDefinition,
): WorkflowDefinition => {
  if (definition.name !== "aop-default-gpt") {
    return definition;
  }

  return restoreLegacyReviewPipeline(
    migrateCleanupReviewRename(
      removeLegacyPlanningBridge(migrateLegacyImplementStep(migrateStepAgents(definition))),
    ),
  );
};

const LEGACY_SKILL_ID_RENAMES: Record<string, string> = {
  [LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID]: AOP_DEFAULT_IMPLEMENT_STEP_ID,
  [LEGACY_AOP_DEFAULT_CLEANUP_STEP_ID]: AOP_DEFAULT_SIMPLIFICATION_STEP_ID,
  [LEGACY_TWO_AXIS_REVIEW_STEP_ID]: NUCLEAR_REVIEW_STEP_ID,
  run_tests: "run-tests",
};

export const normalizeLegacyAopDefaultSkillId = (skillId: string): string =>
  LEGACY_SKILL_ID_RENAMES[skillId] ?? skillId;
