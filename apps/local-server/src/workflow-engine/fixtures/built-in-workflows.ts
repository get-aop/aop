import { DEFAULT_WORKFLOW_STEP_AGENT } from "@aop/common";
import type { WorkflowDefinition } from "../types.ts";
import { validateAndParseWorkflow } from "../workflow-parser.ts";

/**
 * Test fixtures for the retired built-in workflow catalog (aop-default-gpt,
 * aop-default-claude, landing-page). Kept only so engine behavior tests can
 * keep exercising the canonical default-loop shapes; nothing is synced or
 * served at runtime anymore.
 */

const AOP_DEFAULT_CANVAS = {
  version: 1,
  nodes: {
    implement: { x: 180.4527292901135, y: 80 },
    "run-tests": { x: 71.16462428538883, y: 343.5603951738553 },
    "debug-failures": { x: 480.33589671699025, y: 382.8607080993895 },
    simplification: { x: -352.05030202168587, y: 406.7465524136999 },
    nuclear_review: { x: -310.1688200129121, y: 693.3739449114456 },
    "fix-issues": { x: 81.08727426002815, y: 741.9844204678584 },
    "quick-review": { x: 501.51490100373417, y: 758.9467818024953 },
    __done__: { x: 575.1947128918395, y: 1166.1772307915287 },
    __paused__: { x: 3960, y: 160 },
    __blocked__: { x: -1413.3179627749985, y: 680.0100241797116 },
  },
  edges: {
    "implement::failure::__blocked__": { sourceHandle: "left", targetHandle: "left" },
    "implement::success::run-tests": {
      sourceHandle: "bottom-left",
      targetHandle: "top-left",
    },
    "run-tests::TESTS_FAIL::debug-failures": {
      sourceHandle: "right",
      targetHandle: "left",
    },
    "run-tests::failure::__blocked__": { sourceHandle: "left", targetHandle: "left" },
    "run-tests::TESTS_PASS::simplification": {
      sourceHandle: "left",
      targetHandle: "right",
    },
    "debug-failures::failure::__blocked__": { sourceHandle: "top-left", targetHandle: "left" },
    "debug-failures::FIX_COMPLETE::run-tests": {
      sourceHandle: "bottom-left",
      targetHandle: "bottom-left",
    },
    "simplification::failure::__blocked__": { sourceHandle: "top-left", targetHandle: "left" },
    "simplification::CLEANUP_COMPLETE::nuclear_review": {
      sourceHandle: "bottom-left",
      targetHandle: "top-left",
    },
    "nuclear_review::REVIEW_FAILED::fix-issues": {
      sourceHandle: "right",
      targetHandle: "left",
    },
    "nuclear_review::failure::__blocked__": { sourceHandle: "left", targetHandle: "left" },
    "nuclear_review::REVIEW_PASSED::__done__": {
      sourceHandle: "bottom-left",
      targetHandle: "left",
    },
    "fix-issues::FIX_COMPLETE::quick-review": { sourceHandle: "right", targetHandle: "left" },
    "fix-issues::failure::__blocked__": { sourceHandle: "top-left", targetHandle: "left" },
    "quick-review::REVIEW_FAILED::fix-issues": {
      sourceHandle: "bottom-left",
      targetHandle: "bottom-left",
    },
    "quick-review::REVIEW_PASSED::__done__": { sourceHandle: "right", targetHandle: "left" },
    "quick-review::failure::__blocked__": { sourceHandle: "top-left", targetHandle: "left" },
  },
} satisfies NonNullable<WorkflowDefinition["canvas"]>;

const AOP_DEFAULT_GPT_WORKFLOW_DEFINITION: WorkflowDefinition = {
  version: 1,
  name: "aop-default-gpt",
  initialStep: "implement",
  steps: {
    implement: {
      id: "implement",
      type: "implement",
      promptTemplate: "implement.md.hbs",
      maxAttempts: 1,
      agent: {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "low",
        fastMode: true,
      },
      transitions: [
        { condition: "failure", target: "__blocked__" },
        { condition: "success", target: "run-tests" },
      ],
      signals: [
        { name: "CHUNK_DONE", description: "completed a chunk, more tasks remain" },
        { name: "ALL_TASKS_DONE", description: "all implementation tasks are complete" },
      ],
    },
    "run-tests": {
      id: "run-tests",
      type: "test",
      promptTemplate: "run-tests.md.hbs",
      maxAttempts: 1,
      agent: {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "medium",
        fastMode: true,
      },
      transitions: [
        {
          condition: "TESTS_FAIL",
          target: "debug-failures",
          maxIterations: 5,
          onMaxIterations: "__blocked__",
        },
        { condition: "failure", target: "__blocked__" },
        { condition: "TESTS_PASS", target: "simplification" },
      ],
      signals: [
        { name: "TESTS_PASS", description: "required local verification passed" },
        { name: "TESTS_FAIL", description: "required local verification failed" },
      ],
    },
    "debug-failures": {
      id: "debug-failures",
      type: "debug",
      promptTemplate: "debug-systematic.md.hbs",
      maxAttempts: 1,
      agent: {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "extra-high",
        fastMode: true,
      },
      transitions: [
        { condition: "failure", target: "__blocked__" },
        { condition: "FIX_COMPLETE", target: "run-tests" },
      ],
      signals: [{ name: "FIX_COMPLETE", description: "root cause fixed and verified locally" }],
    },
    simplification: {
      id: "simplification",
      type: "review",
      promptTemplate: "simplification.md.hbs",
      maxAttempts: 1,
      agent: {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "medium",
        fastMode: true,
      },
      transitions: [
        { condition: "failure", target: "__blocked__" },
        { condition: "CLEANUP_COMPLETE", target: "nuclear_review" },
      ],
      signals: [
        {
          name: "CLEANUP_COMPLETE",
          description: "cleanup and simplification pass completed",
        },
      ],
    },
    nuclear_review: {
      id: "nuclear_review",
      type: "review",
      promptTemplate: "nuclear-review.md.hbs",
      maxAttempts: 1,
      agent: {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "extra-high",
        fastMode: true,
      },
      transitions: [
        { condition: "REVIEW_FAILED", target: "fix-issues" },
        { condition: "failure", target: "__blocked__" },
        { condition: "REVIEW_PASSED", target: "__done__" },
      ],
      signals: [
        { name: "REVIEW_PASSED", description: "code is clean and ready" },
        {
          name: "REVIEW_FAILED",
          description: "found issues that need the implementer to address",
        },
      ],
    },
    "fix-issues": {
      id: "fix-issues",
      type: "implement",
      promptTemplate: "fix-issues.md.hbs",
      maxAttempts: 1,
      agent: {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "low",
        fastMode: true,
      },
      transitions: [
        { condition: "FIX_COMPLETE", target: "quick-review" },
        { condition: "failure", target: "__blocked__" },
      ],
      signals: [{ name: "FIX_COMPLETE", description: "all review issues have been addressed" }],
    },
    "quick-review": {
      id: "quick-review",
      type: "review",
      promptTemplate: "quick-review.md.hbs",
      maxAttempts: 1,
      agent: {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "extra-high",
        fastMode: true,
      },
      transitions: [
        { condition: "REVIEW_FAILED", target: "fix-issues" },
        { condition: "REVIEW_PASSED", target: "__done__" },
        { condition: "failure", target: "__blocked__" },
      ],
      signals: [
        { name: "REVIEW_PASSED", description: "fixes verified, all checks pass" },
        { name: "REVIEW_FAILED", description: "issues remain or new issues found" },
      ],
    },
  },
  terminalStates: ["__done__", "__blocked__", "__paused__", "__draft__"],
  canvas: AOP_DEFAULT_CANVAS,
};

const createAopDefaultClaudeWorkflowDefinition = (): WorkflowDefinition => ({
  ...AOP_DEFAULT_GPT_WORKFLOW_DEFINITION,
  name: "aop-default-claude",
  steps: Object.fromEntries(
    Object.entries(AOP_DEFAULT_GPT_WORKFLOW_DEFINITION.steps).map(([id, step]) => [
      id,
      {
        ...step,
        agent: step.agent
          ? {
              ...step.agent,
              provider: "claude-code",
              model: "claude-opus-4-8",
              fastMode: false,
            }
          : step.agent,
      },
    ]),
  ) as WorkflowDefinition["steps"],
});

const BUILT_IN_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  AOP_DEFAULT_GPT_WORKFLOW_DEFINITION,
  createAopDefaultClaudeWorkflowDefinition(),
  {
    version: 1,
    name: "landing-page",
    initialStep: "market_analysis",
    steps: {
      market_analysis: {
        id: "market_analysis",
        type: "research",
        promptTemplate: "market-analysis.md.hbs",
        maxAttempts: 3,
        transitions: [
          { condition: "RESEARCH_COMPLETE", target: "design_brief" },
          { condition: "__none__", target: "market_analysis" },
          { condition: "failure", target: "__blocked__" },
        ],
        signals: [
          {
            name: "RESEARCH_COMPLETE",
            description: "market research is done, findings are written",
          },
        ],
      },
      design_brief: {
        id: "design_brief",
        type: "iterate",
        promptTemplate: "design-brief.md.hbs",
        maxAttempts: 3,
        transitions: [
          { condition: "BRIEF_READY", target: "outline_page" },
          { condition: "REQUIRES_INPUT", target: "__paused__" },
          { condition: "__none__", target: "design_brief" },
          { condition: "failure", target: "__blocked__" },
        ],
        signals: [
          { name: "BRIEF_READY", description: "design brief with tokens is written and ready" },
          { name: "REQUIRES_INPUT", description: "need visual references or brand direction" },
        ],
      },
      outline_page: {
        id: "outline_page",
        type: "iterate",
        promptTemplate: "outline-landing-page.md.hbs",
        maxAttempts: 3,
        transitions: [
          { condition: "PLAN_READY", target: "__paused__" },
          { condition: "PLAN_APPROVED", target: "write_copy" },
          { condition: "REQUIRES_INPUT", target: "__paused__" },
          { condition: "__none__", target: "outline_page" },
          { condition: "failure", target: "__blocked__" },
        ],
        signals: [
          {
            name: "PLAN_READY",
            description: "outline is written to plan.md, ready for human approval",
          },
          {
            name: "PLAN_APPROVED",
            description: "human approved the outline, proceed to copy",
          },
          { name: "REQUIRES_INPUT", description: "need clarification on page structure or goals" },
        ],
      },
      write_copy: {
        id: "write_copy",
        type: "iterate",
        promptTemplate: "landing-page-copy.md.hbs",
        maxAttempts: 5,
        transitions: [
          { condition: "CONTENT_READY", target: "implement_page" },
          { condition: "REQUIRES_INPUT", target: "__paused__" },
          { condition: "__none__", target: "implement_page" },
          { condition: "failure", target: "__blocked__" },
        ],
        signals: [
          { name: "CONTENT_READY", description: "copy is written and CRO-reviewed" },
          { name: "REQUIRES_INPUT", description: "need clarification on messaging or tone" },
        ],
      },
      implement_page: {
        id: "implement_page",
        type: "implement",
        promptTemplate: "implement-frontend.md.hbs",
        maxAttempts: 15,
        transitions: [
          { condition: "success", target: "visual_verify" },
          { condition: "failure", target: "__blocked__" },
        ],
        signals: [],
      },
      visual_verify: {
        id: "visual_verify",
        type: "review",
        promptTemplate: "visual-verify.md.hbs",
        maxAttempts: 5,
        transitions: [
          { condition: "LOOKS_GOOD", target: "add_differentiator" },
          {
            condition: "NEEDS_CHANGES",
            target: "implement_page",
            maxIterations: 3,
            onMaxIterations: "__blocked__",
          },
          { condition: "REQUIRES_INPUT", target: "__paused__" },
          { condition: "failure", target: "__blocked__" },
        ],
        signals: [
          { name: "LOOKS_GOOD", description: "visual implementation matches expectations" },
          { name: "NEEDS_CHANGES", description: "identified visual issues that need fixing" },
          { name: "REQUIRES_INPUT", description: "need human judgment on the visual result" },
        ],
      },
      add_differentiator: {
        id: "add_differentiator",
        type: "implement",
        promptTemplate: "add-differentiator.md.hbs",
        maxAttempts: 10,
        transitions: [
          { condition: "success", target: "seo_audit" },
          { condition: "failure", target: "__blocked__" },
        ],
        signals: [],
      },
      seo_audit: {
        id: "seo_audit",
        type: "review",
        promptTemplate: "seo-audit.md.hbs",
        maxAttempts: 1,
        transitions: [
          { condition: "SEO_PASS", target: "code_review" },
          {
            condition: "SEO_NEEDS_WORK",
            target: "implement_page",
            maxIterations: 2,
            onMaxIterations: "__blocked__",
          },
          { condition: "failure", target: "__blocked__" },
        ],
        signals: [
          { name: "SEO_PASS", description: "SEO checks meet acceptable thresholds" },
          { name: "SEO_NEEDS_WORK", description: "issues found that need addressing" },
        ],
      },
      code_review: {
        id: "code_review",
        type: "review",
        promptTemplate: "code-review-step.md.hbs",
        maxAttempts: 2,
        transitions: [
          { condition: "REVIEW_PASSED", target: "__done__" },
          {
            condition: "REVIEW_FAILED",
            target: "implement_page",
            maxIterations: 2,
            onMaxIterations: "__blocked__",
          },
          { condition: "failure", target: "__blocked__" },
        ],
        signals: [
          { name: "REVIEW_PASSED", description: "code is clean and ready" },
          {
            name: "REVIEW_FAILED",
            description: "found issues that need the implementer to address",
          },
        ],
      },
    },
    terminalStates: ["__done__", "__blocked__", "__paused__"],
  },
];

const BUILT_IN_WORKFLOW_FIXTURES = BUILT_IN_WORKFLOW_DEFINITIONS.map((definition) =>
  validateAndParseWorkflow(ensureBuiltInStepAgents(definition)),
);

export const listBuiltInWorkflowFixtures = (): WorkflowDefinition[] =>
  BUILT_IN_WORKFLOW_FIXTURES.map(cloneWorkflow);

export const loadBuiltInWorkflowFixture = (name: string): WorkflowDefinition => {
  const workflow = BUILT_IN_WORKFLOW_FIXTURES.find((candidate) => candidate.name === name);
  if (!workflow) {
    throw new Error(`Built-in workflow fixture "${name}" not found`);
  }

  return cloneWorkflow(workflow);
};

const cloneWorkflow = (workflow: WorkflowDefinition): WorkflowDefinition =>
  JSON.parse(JSON.stringify(workflow)) as WorkflowDefinition;

function ensureBuiltInStepAgents(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    steps: Object.fromEntries(
      Object.entries(definition.steps).map(([stepId, step]) => [
        stepId,
        {
          ...step,
          agent: step.agent ?? createDefaultStepAgent(),
        },
      ]),
    ),
  };
}

function createDefaultStepAgent(): NonNullable<WorkflowDefinition["steps"][string]["agent"]> {
  return { ...DEFAULT_WORKFLOW_STEP_AGENT };
}
