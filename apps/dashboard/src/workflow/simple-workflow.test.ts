import { describe, expect, test } from "bun:test";
import type { WorkflowStepAgent, WorkflowSummary, WorkflowSummaryStep } from "../api/client";
import {
  BROWSER_STEP_PROVIDERS,
  bumpReasoning,
  compileSimpleWorkflow,
  decompileSimpleWorkflow,
  type SimpleWorkflow,
  SimpleWorkflowError,
  type SimpleWorkflowStep,
} from "./simple-workflow";

const agent = (overrides: Partial<WorkflowStepAgent> = {}): WorkflowStepAgent => ({
  provider: "claude-code",
  model: "opus",
  reasoning: "high",
  ...overrides,
});

const step = (
  kind: SimpleWorkflowStep["kind"],
  overrides: Partial<WorkflowStepAgent> = {},
): SimpleWorkflowStep => ({
  kind,
  agent: agent(overrides),
});

const workflow = (steps: SimpleWorkflowStep[], name = "Ship it"): SimpleWorkflow => ({
  name,
  steps,
});

const summary = (steps: WorkflowSummaryStep[], name = "Ship it"): WorkflowSummary => ({
  id: "wf-1",
  name,
  version: 1,
  active: true,
  source: "user",
  stepCount: steps.length,
  steps,
});

/** Simulate the server summary shape: compiled payload + promptTemplate resolution. */
const asSummarySteps = (
  compiled: import("../api/client").WorkflowStepSaveInput[],
): WorkflowSummaryStep[] =>
  compiled.map((step) => ({
    id: step.id!,
    type: step.skillId,
    promptTemplate:
      {
        implement: "implement.md.hbs",
        code_review: "code-review-step.md.hbs",
        "run-tests": "run-tests.md.hbs",
        browser_control: "browser-control.md.hbs",
        "debug-failures": "debug-systematic.md.hbs",
        "fix-issues": "fix-issues.md.hbs",
      }[step.skillId] ?? "unknown.md.hbs",
    maxAttempts: 1,
    transitions: step.transitions ?? [],
    agent: step.agent,
  }));

describe("compileSimpleWorkflow", () => {
  test("compiles a single implement step with helper and terminal targets", () => {
    const steps = compileSimpleWorkflow(workflow([step("implement")]));

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      id: "implement-1",
      skillId: "implement",
      agent: agent(),
      transitions: [
        { condition: "success", target: "__done__" },
        {
          condition: "failure",
          target: "implement-1--debug",
          maxIterations: 2,
          onMaxIterations: "__blocked__",
        },
      ],
    });
    expect(steps[1]).toMatchObject({
      id: "implement-1--debug",
      skillId: "debug-failures",
      transitions: [{ condition: "FIX_COMPLETE", target: "implement-1" }],
    });
  });

  test("chains next-step targets across a four-step recipe", () => {
    const steps = compileSimpleWorkflow(
      workflow([step("implement"), step("code-review"), step("test"), step("browser")]),
    );

    const parents = steps.filter((s) => !s.id!.includes("--"));
    expect(parents.map((s) => s.id)).toEqual([
      "implement-1",
      "code-review-2",
      "test-3",
      "browser-4",
    ]);
    expect(parents[0]!.transitions![0]).toEqual({
      condition: "success",
      target: "code-review-2",
    });
    expect(parents[3]!.transitions![0]).toEqual({
      condition: "BROWSER_TASK_COMPLETE",
      target: "__done__",
    });
  });

  test("code-review failure routes to a fix-issues helper with REVIEW_FAILED", () => {
    const steps = compileSimpleWorkflow(workflow([step("code-review")]));
    expect(steps[0]!.transitions![1]).toEqual({
      condition: "REVIEW_FAILED",
      target: "code-review-1--fix",
      maxIterations: 2,
      onMaxIterations: "__blocked__",
    });
    expect(steps[1]).toMatchObject({
      id: "code-review-1--fix",
      skillId: "fix-issues",
      transitions: [{ condition: "FIX_COMPLETE", target: "code-review-1" }],
    });
  });

  test("test failures allow up to five debug iterations", () => {
    const steps = compileSimpleWorkflow(workflow([step("test")]));
    expect(steps[0]!.transitions![1]).toMatchObject({
      condition: "TESTS_FAIL",
      target: "test-1--debug",
      maxIterations: 5,
      onMaxIterations: "__blocked__",
    });
  });

  test("browser steps force browserControl and require a compatible provider", () => {
    const steps = compileSimpleWorkflow(workflow([step("browser")]));
    expect(steps[0]!.agent!.browserControl).toBe(true);

    expect(() =>
      compileSimpleWorkflow(workflow([step("browser", { provider: "grok-build" })])),
    ).toThrow(SimpleWorkflowError);
    expect(BROWSER_STEP_PROVIDERS).toEqual(["claude-code", "codex-cli"]);
  });

  test("helper agents bump reasoning one tier and keep max at max", () => {
    const steps = compileSimpleWorkflow(workflow([step("implement", { reasoning: "medium" })]));
    expect(steps[1]!.agent!.reasoning).toBe("high");
    expect(steps[1]!.agent!.model).toBe("opus");

    const maxSteps = compileSimpleWorkflow(workflow([step("test", { reasoning: "max" })]));
    expect(maxSteps[1]!.agent!.reasoning).toBe("max");
  });

  test("validates name and step count", () => {
    expect(() => compileSimpleWorkflow(workflow([], " "))).toThrow(SimpleWorkflowError);
    expect(() => compileSimpleWorkflow({ name: "x", steps: [] })).toThrow(SimpleWorkflowError);
    expect(() =>
      compileSimpleWorkflow(workflow(Array.from({ length: 9 }, () => step("implement")))),
    ).toThrow(SimpleWorkflowError);
  });

  test("bumpReasoning ladder", () => {
    expect(bumpReasoning(agent({ reasoning: "low" })).reasoning).toBe("medium");
    expect(bumpReasoning(agent({ reasoning: "high" })).reasoning).toBe("extra-high");
    expect(bumpReasoning(agent({ reasoning: "max" })).reasoning).toBe("max");
  });
});

describe("decompileSimpleWorkflow", () => {
  test("round-trips a compiled workflow", () => {
    const source = workflow([
      step("implement", {
        provider: "codex-cli",
        model: "gpt-5.6",
        reasoning: "high",
        fastMode: true,
      }),
      step("code-review"),
      step("test"),
      step("browser", { provider: "codex-cli" }),
    ]);
    const steps = compileSimpleWorkflow(source);
    const back = decompileSimpleWorkflow(summary(asSummarySteps(steps), source.name));

    expect(back).not.toBeNull();
    expect(back!.name).toBe("Ship it");
    expect(back!.steps).toHaveLength(4);
    expect(back!.steps.map((s) => s.kind)).toEqual(["implement", "code-review", "test", "browser"]);
    expect(back!.steps[0]!.agent).toMatchObject({
      provider: "codex-cli",
      model: "gpt-5.6",
      reasoning: "high",
      fastMode: true,
    });
    expect(back!.steps[3]!.agent.browserControl).toBe(true);
  });

  test("reports legacy for unrecognized prompt templates", () => {
    const steps = compileSimpleWorkflow(workflow([step("implement")]));
    // WorkflowSummaryStep has no skillId — the template is the recognition signal.
    const legacy = summary([{ ...asSummarySteps(steps)[0]!, promptTemplate: "seo-audit.md.hbs" }]);
    expect(decompileSimpleWorkflow(legacy)).toBeNull();
  });

  test("reports legacy when the helper shape is wrong", () => {
    const steps = compileSimpleWorkflow(workflow([step("implement")]));
    const serverSteps = asSummarySteps(steps);
    const bad = summary([
      serverSteps[0]!,
      { ...serverSteps[1]!, transitions: [{ condition: "FIX_COMPLETE", target: "elsewhere" }] },
    ]);
    expect(decompileSimpleWorkflow(bad)).toBeNull();
  });

  test("reports legacy when the failure transition is missing", () => {
    const steps = compileSimpleWorkflow(workflow([step("implement")]));
    const withoutFailure = summary([
      { ...asSummarySteps(steps)[0]!, transitions: [{ condition: "success", target: "__done__" }] },
    ]);
    expect(decompileSimpleWorkflow(withoutFailure)).toBeNull();
  });

  test("reports legacy for empty or unnamed workflows", () => {
    expect(decompileSimpleWorkflow(summary([], " "))).toBeNull();
    expect(decompileSimpleWorkflow(summary([], ""))).toBeNull();
  });
});
