import { describe, expect, test } from "bun:test";
import {
  AOP_DEFAULT_IMPLEMENT_STEP_ID,
  LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID,
  migrateAopDefaultWorkflowDefinition,
  normalizeLegacyAopDefaultSkillId,
} from "./aop-default-gpt-migrations.ts";
import { loadBuiltInWorkflowFixture } from "./fixtures/built-in-workflows.ts";
import type { WorkflowDefinition } from "./types.ts";

const twoAxisSavedDefinition = (): WorkflowDefinition => ({
  version: 1,
  name: "aop-default-gpt",
  initialStep: "implement",
  terminalStates: ["__done__", "__blocked__", "__paused__", "__draft__"],
  steps: {
    implement: {
      id: "implement",
      type: "implement",
      promptTemplate: "implement.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "failure", target: "__blocked__" },
        { condition: "success", target: "run-tests" },
      ],
    },
    "run-tests": {
      id: "run-tests",
      type: "test",
      promptTemplate: "run-tests.md.hbs",
      maxAttempts: 1,
      transitions: [
        {
          condition: "TESTS_FAIL",
          target: "debug-failures",
          maxIterations: 5,
          onMaxIterations: "__blocked__",
        },
        { condition: "failure", target: "__blocked__" },
        { condition: "TESTS_PASS", target: "review" },
      ],
    },
    "debug-failures": {
      id: "debug-failures",
      type: "debug",
      promptTemplate: "debug-systematic.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "failure", target: "__blocked__" },
        { condition: "FIX_COMPLETE", target: "run-tests" },
      ],
    },
    review: {
      id: "review",
      type: "review",
      promptTemplate: "review.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "REVIEW_FAILED", target: "fix-issues" },
        { condition: "failure", target: "__blocked__" },
        { condition: "REVIEW_PASSED", target: "__done__" },
      ],
    },
    "fix-issues": {
      id: "fix-issues",
      type: "implement",
      promptTemplate: "fix-issues.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "FIX_COMPLETE", target: "quick-review" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
    "quick-review": {
      id: "quick-review",
      type: "review",
      promptTemplate: "quick-review.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "REVIEW_FAILED", target: "fix-issues" },
        { condition: "REVIEW_PASSED", target: "__done__" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
  },
});

describe("aop-default-gpt migrations", () => {
  test("built-in fixture uses implement step block id, not iterate", () => {
    const workflow = loadBuiltInWorkflowFixture("aop-default-gpt");

    expect(workflow.initialStep).toBe("implement");
    expect(workflow.steps[AOP_DEFAULT_IMPLEMENT_STEP_ID]?.promptTemplate).toBe("implement.md.hbs");
    expect(workflow.steps[LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID]).toBeUndefined();
    expect(workflow.steps.planning_cli_plan).toBeUndefined();
  });

  test("built-in fixture runs aop-default-gpt on codex-cli fast mode", () => {
    const workflow = loadBuiltInWorkflowFixture("aop-default-gpt");

    for (const step of Object.values(workflow.steps)) {
      expect(step.agent).toEqual(
        expect.objectContaining({
          provider: "codex-cli",
          model: "gpt-5.5",
          fastMode: true,
        }),
      );
    }
  });

  test("migrateAopDefaultWorkflowDefinition renames legacy iterate step and canvas", () => {
    const migrated = migrateAopDefaultWorkflowDefinition({
      version: 1,
      name: "aop-default-gpt",
      initialStep: LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID,
      steps: {
        [LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID]: {
          id: LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID,
          type: "iterate",
          promptTemplate: "implement.md.hbs",
          maxAttempts: 1,
          transitions: [
            { condition: "CHUNK_DONE", target: LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID },
            { condition: "ALL_TASKS_DONE", target: "run-tests" },
          ],
        },
        "run-tests": {
          id: "run-tests",
          type: "test",
          promptTemplate: "run-tests.md.hbs",
          maxAttempts: 1,
          transitions: [{ condition: "success", target: "__done__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__"],
      canvas: {
        version: 1,
        nodes: { [LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID]: { x: 10, y: 20 } },
      },
    });

    expect(migrated.initialStep).toBe(AOP_DEFAULT_IMPLEMENT_STEP_ID);
    expect(migrated.steps[LEGACY_AOP_DEFAULT_IMPLEMENT_STEP_ID]).toBeUndefined();
    expect(migrated.steps[AOP_DEFAULT_IMPLEMENT_STEP_ID]?.id).toBe(AOP_DEFAULT_IMPLEMENT_STEP_ID);
    expect(migrated.steps[AOP_DEFAULT_IMPLEMENT_STEP_ID]?.type).toBe("implement");
    expect(migrated.steps[AOP_DEFAULT_IMPLEMENT_STEP_ID]?.transitions).toContainEqual({
      condition: "success",
      target: "run-tests",
    });
    expect(migrated.steps[AOP_DEFAULT_IMPLEMENT_STEP_ID]?.transitions).not.toContainEqual(
      expect.objectContaining({ condition: "CHUNK_DONE" }),
    );
    expect(migrated.canvas?.nodes[AOP_DEFAULT_IMPLEMENT_STEP_ID]).toEqual({ x: 10, y: 20 });
  });

  test("migrateAopDefaultWorkflowDefinition drops the legacy planning bridge", () => {
    const migrated = migrateAopDefaultWorkflowDefinition({
      version: 1,
      name: "aop-default-gpt",
      initialStep: "planning_cli_plan",
      steps: {
        planning_cli_plan: {
          id: "planning_cli_plan",
          type: "iterate",
          promptTemplate: "planning-cli-plan.md.hbs",
          maxAttempts: 1,
          agent: {
            provider: "codex-cli",
            model: "gpt-5.5",
            reasoning: "medium",
            fastMode: true,
          },
          transitions: [{ condition: "success", target: "implement" }],
        },
        human_in_loop: {
          id: "human_in_loop",
          type: "iterate",
          promptTemplate: "human-in-loop.md.hbs",
          maxAttempts: 1,
          transitions: [{ condition: "success", target: "lifecycle_mark_ready" }],
        },
        lifecycle_mark_ready: {
          id: "lifecycle_mark_ready",
          type: "iterate",
          promptTemplate: "lifecycle-mark-ready.md.hbs",
          maxAttempts: 1,
          transitions: [{ condition: "success", target: "implement" }],
        },
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
          transitions: [{ condition: "success", target: "__done__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__"],
      canvas: {
        version: 1,
        nodes: {
          planning_cli_plan: { x: 0, y: 0 },
          human_in_loop: { x: 100, y: 0 },
          lifecycle_mark_ready: { x: 200, y: 0 },
          implement: { x: 300, y: 0 },
        },
        edges: {
          "planning_cli_plan::success::human_in_loop": {},
          "human_in_loop::success::lifecycle_mark_ready": {},
          "lifecycle_mark_ready::success::implement": {},
        },
      },
    });

    expect(migrated.initialStep).toBe("implement");
    expect(migrated.steps.planning_cli_plan).toBeUndefined();
    expect(migrated.steps.human_in_loop).toBeUndefined();
    expect(migrated.steps.lifecycle_mark_ready).toBeUndefined();
    expect(migrated.steps.implement?.agent).toEqual({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "low",
      fastMode: true,
    });
    expect(migrated.canvas?.nodes).toEqual({ implement: { x: 300, y: 0 } });
    expect(migrated.canvas?.edges).toBeUndefined();
  });

  test("migrateAopDefaultWorkflowDefinition preserves aop-default-gpt extra-high effort", () => {
    const migrated = migrateAopDefaultWorkflowDefinition({
      version: 1,
      name: "aop-default-gpt",
      initialStep: "review",
      steps: {
        review: {
          id: "review",
          type: "review",
          promptTemplate: "review.md.hbs",
          maxAttempts: 1,
          agent: {
            provider: "opencode",
            model: "openai/gpt-5.5-fast",
            reasoning: "extra-high",
            fastMode: false,
          },
          transitions: [{ condition: "success", target: "__done__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__"],
    });

    // migrateStepAgents normalizes the agent under the legacy "review" key before
    // restoreLegacyReviewPipeline splits the step into nuclear_review + simplification.
    expect(migrated.steps.nuclear_review?.agent).toEqual({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "extra-high",
      fastMode: true,
    });
  });

  test("migrateAopDefaultWorkflowDefinition leaves non-default workflow agents alone", () => {
    const workflow: WorkflowDefinition = {
      version: 1,
      name: "custom",
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
            reasoning: "medium",
            fastMode: true,
          },
          transitions: [{ condition: "success", target: "__done__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__"],
    };

    expect(migrateAopDefaultWorkflowDefinition(workflow)).toBe(workflow);
  });

  test("normalizeLegacyAopDefaultSkillId maps iterate block id to implement", () => {
    expect(normalizeLegacyAopDefaultSkillId("iterate")).toBe("implement");
    expect(normalizeLegacyAopDefaultSkillId("run-tests")).toBe("run-tests");
  });

  test("normalizeLegacyAopDefaultSkillId maps the duplicate run_tests id to run-tests", () => {
    expect(normalizeLegacyAopDefaultSkillId("run_tests")).toBe("run-tests");
  });

  test("normalizeLegacyAopDefaultSkillId maps cleanup-review block id to simplification", () => {
    expect(normalizeLegacyAopDefaultSkillId("cleanup-review")).toBe("simplification");
  });

  test("migrateAopDefaultWorkflowDefinition renames saved cleanup-review to simplification", () => {
    const migrated = migrateAopDefaultWorkflowDefinition({
      version: 1,
      name: "aop-default-gpt",
      initialStep: "run-tests",
      steps: {
        "run-tests": {
          id: "run-tests",
          type: "test",
          promptTemplate: "run-tests.md.hbs",
          maxAttempts: 1,
          transitions: [{ condition: "TESTS_PASS", target: "cleanup-review" }],
        },
        "cleanup-review": {
          id: "cleanup-review",
          type: "review",
          promptTemplate: "cleanup-review.md.hbs",
          maxAttempts: 1,
          transitions: [{ condition: "CLEANUP_COMPLETE", target: "__done__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__"],
      canvas: {
        version: 1,
        nodes: { "cleanup-review": { x: 5, y: 6 }, "run-tests": { x: 1, y: 2 } },
        edges: {
          "run-tests::TESTS_PASS::cleanup-review": { sourceHandle: "left", targetHandle: "right" },
        },
      },
    });

    expect(migrated.steps["cleanup-review"]).toBeUndefined();
    expect(migrated.steps.simplification?.id).toBe("simplification");
    expect(migrated.steps.simplification?.promptTemplate).toBe("simplification.md.hbs");
    expect(migrated.steps["run-tests"]?.transitions).toContainEqual({
      condition: "TESTS_PASS",
      target: "simplification",
    });
    expect(migrated.canvas?.nodes.simplification).toEqual({ x: 5, y: 6 });
    expect(migrated.canvas?.edges?.["run-tests::TESTS_PASS::simplification"]).toEqual({
      sourceHandle: "left",
      targetHandle: "right",
    });
  });

  describe("restoreLegacyReviewPipeline", () => {
    test("splits a saved two-axis review chain back into simplification + nuclear_review", () => {
      const migrated = migrateAopDefaultWorkflowDefinition(twoAxisSavedDefinition());

      expect(migrated.steps.review).toBeUndefined();
      expect(migrated.steps.nuclear_review?.promptTemplate).toBe("nuclear-review.md.hbs");
      expect(migrated.steps.nuclear_review?.transitions).toEqual([
        { condition: "REVIEW_FAILED", target: "fix-issues" },
        { condition: "failure", target: "__blocked__" },
        { condition: "REVIEW_PASSED", target: "__done__" },
      ]);
      expect(migrated.steps.simplification?.promptTemplate).toBe("simplification.md.hbs");
      expect(migrated.steps.simplification?.transitions).toEqual([
        { condition: "failure", target: "__blocked__" },
        { condition: "CLEANUP_COMPLETE", target: "nuclear_review" },
      ]);
      expect(migrated.steps["run-tests"]?.transitions).toContainEqual({
        condition: "TESTS_PASS",
        target: "simplification",
      });
    });

    test("normalizes inline two-axis prompt overrides onto the nuclear template", () => {
      const definition = twoAxisSavedDefinition();
      const reviewStep = definition.steps.review;
      if (!reviewStep) throw new Error("fixture must define review");
      reviewStep.promptTemplate = "inline: custom review prompt";

      const migrated = migrateAopDefaultWorkflowDefinition(definition);
      expect(migrated.steps.nuclear_review?.promptTemplate).toBe("nuclear-review.md.hbs");
    });

    test("is a no-op for definitions already in the restored shape", () => {
      const restored = migrateAopDefaultWorkflowDefinition(twoAxisSavedDefinition());
      expect(migrateAopDefaultWorkflowDefinition(restored)).toEqual(restored);
    });

    test("does not touch non-default workflows", () => {
      const definition = { ...twoAxisSavedDefinition(), name: "my-custom-flow" };
      expect(migrateAopDefaultWorkflowDefinition(definition)).toEqual(definition);
    });
  });

  test("normalizeLegacyAopDefaultSkillId maps the retired two-axis review id", () => {
    expect(normalizeLegacyAopDefaultSkillId("review")).toBe("nuclear_review");
    expect(normalizeLegacyAopDefaultSkillId("cleanup-review")).toBe("simplification");
    expect(normalizeLegacyAopDefaultSkillId("iterate")).toBe("implement");
    expect(normalizeLegacyAopDefaultSkillId("run_tests")).toBe("run-tests");
    expect(normalizeLegacyAopDefaultSkillId("nuclear_review")).toBe("nuclear_review");
  });
});
