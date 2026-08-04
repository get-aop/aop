import { describe, expect, test } from "bun:test";
import { createStepCommandGenerator } from "./step-command-generator.ts";
import type { WorkflowStep } from "./types.ts";

describe("StepCommandGenerator", () => {
  test("loads the prompt template and enriches known signal descriptions from the step library", async () => {
    const generator = createStepCommandGenerator({
      load: async (template) => `resolved:${template}`,
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "run_tests",
      type: "test",
      promptTemplate: "run-tests.md.hbs",
      maxAttempts: 1,
      isolation: "open",
      signals: [{ name: "TESTS_PASS", description: "yaml description" }],
      transitions: [],
    };

    const command = await generator.generate(step, "step-1", 2, 3);

    expect(command).toMatchObject({
      id: "step-1",
      type: "test",
      stepId: "run_tests",
      promptTemplate: "resolved:run-tests.md.hbs",
      attempt: 2,
      iteration: 3,
      isolation: "open",
      signals: [
        {
          name: "TESTS_PASS",
          description: "required local verification passed",
        },
      ],
    });
  });

  test("keeps YAML signal descriptions for steps that are not in the library", async () => {
    const generator = createStepCommandGenerator({
      load: async (template) => template,
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "custom_step",
      type: "implement",
      promptTemplate: "implement.md.hbs",
      maxAttempts: 1,
      signals: [{ name: "CUSTOM", description: "custom description" }],
      transitions: [],
    };

    const command = await generator.generate(step, "step-2", 1, 0);

    expect(command.signals).toEqual([{ name: "CUSTOM", description: "custom description" }]);
  });

  test("defaults signals to an empty array when the workflow step has none", async () => {
    const generator = createStepCommandGenerator({
      load: async () => "resolved",
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "custom_step",
      type: "test",
      promptTemplate: "run-tests.md.hbs",
      maxAttempts: 1,
      transitions: [],
    };

    const command = await generator.generate(step, "step-3", 1, 0);

    expect(command.signals).toEqual([]);
  });

  test("copies step agent config into the generated command", async () => {
    const generator = createStepCommandGenerator({
      load: async () => "resolved",
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "quick-review",
      type: "review",
      promptTemplate: "quick-review.md.hbs",
      maxAttempts: 1,
      agent: {
        provider: "pi",
        model: "openai-codex/gpt-5.5",
        reasoning: "medium",
        fastMode: false,
      },
      transitions: [],
    };

    const command = await generator.generate(step, "step-4", 1, 0);

    expect(command.agent).toEqual({
      provider: "pi",
      model: "openai-codex/gpt-5.5",
      reasoning: "medium",
      fastMode: false,
    });
  });

  test("preserves browser and computer control flags on generated commands", async () => {
    const generator = createStepCommandGenerator({
      load: async () => "resolved",
      clearCache: () => {},
    });
    const browser = await generator.generate(
      {
        id: "browser_control",
        type: "implement",
        promptTemplate: "browser-control.md.hbs",
        maxAttempts: 1,
        agent: {
          provider: "codex-cli",
          model: "gpt-5.5",
          reasoning: "medium",
          fastMode: false,
          browserControl: true,
          computerControl: false,
        },
        transitions: [],
      },
      "step-browser",
      1,
      0,
    );
    expect(browser.agent).toMatchObject({ browserControl: true, computerControl: false });

    const computer = await generator.generate(
      {
        id: "computer_control",
        type: "implement",
        promptTemplate: "computer-control.md.hbs",
        maxAttempts: 1,
        agent: {
          provider: "codex-cli",
          model: "gpt-5.5",
          reasoning: "medium",
          fastMode: true,
          browserControl: false,
          computerControl: true,
        },
        transitions: [],
      },
      "step-computer",
      1,
      0,
    );
    expect(computer.agent).toMatchObject({
      computerControl: true,
      browserControl: false,
      fastMode: true,
    });
  });

  test("copies verification commands into the generated command", async () => {
    const generator = createStepCommandGenerator({
      load: async () => "resolved",
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "run-tests",
      type: "test",
      promptTemplate: "run-tests.md.hbs",
      maxAttempts: 1,
      verifyCommands: ["bun test apps/local-server/src/workflow/service.test.ts"],
      transitions: [],
    };

    const command = await generator.generate(step, "step-5", 1, 0);

    expect(command.verifyCommands).toEqual([
      "bun test apps/local-server/src/workflow/service.test.ts",
    ]);
  });

  test("copies checker marker into the generated command", async () => {
    const generator = createStepCommandGenerator({
      load: async () => "resolved",
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "review",
      type: "review",
      promptTemplate: "review.md.hbs",
      maxAttempts: 1,
      checkerStep: true,
      transitions: [],
    };

    const command = await generator.generate(step, "step-6", 1, 0);

    expect(command.checkerStep).toBe(true);
  });
});
