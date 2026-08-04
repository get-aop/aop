import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { loadBuiltInWorkflowFixture } from "../workflow-engine/fixtures/built-in-workflows.ts";
import {
  createSkillBlock,
  createWorkflowFromSteps,
  listStepLibrary,
  listWorkflowDetails,
  listWorkflows,
} from "./handlers.ts";
import type { CreateSkillBlockInput } from "./service.ts";

describe("listWorkflows", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let localSkillRoot: string | null = null;
  const originalLocalSkillRoots = process.env.AOP_WORKFLOW_SKILL_ROOTS;

  const seedBuiltInFixture = async (name: string): Promise<void> => {
    // Trigger the one-time built-in sync first so it cannot deactivate the
    // fixture row we insert right after (the retired catalog syncs an empty
    // list, which deactivates any built-in row present at that moment).
    await listWorkflows(ctx.workflowService);
    const definition = loadBuiltInWorkflowFixture(name);
    await ctx.workflowRepository.upsert({
      id: definition.name,
      name: definition.name,
      definition: JSON.stringify(definition),
      source: "builtin",
    });
  };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    if (localSkillRoot) {
      rmSync(localSkillRoot, { recursive: true, force: true });
      localSkillRoot = null;
    }
    if (originalLocalSkillRoots === undefined) {
      delete process.env.AOP_WORKFLOW_SKILL_ROOTS;
    } else {
      process.env.AOP_WORKFLOW_SKILL_ROOTS = originalLocalSkillRoots;
    }
  });

  test("does not list the retired built-in workflows", async () => {
    const result = await listWorkflows(ctx.workflowService);
    expect(result.workflows).not.toContain("aop-default-gpt");
    expect(result.workflows).not.toContain("simple");
  });

  test("returns workflows in sorted order", async () => {
    const result = await listWorkflows(ctx.workflowService);
    expect(result.workflows).toEqual([...result.workflows].sort());
  });

  test("returns workflow details with source and step summaries", async () => {
    await seedBuiltInFixture("aop-default-gpt");
    const result = await listWorkflowDetails(ctx.workflowService);
    const defaultWorkflow = result.workflows.find(
      (workflow) => workflow.name === "aop-default-gpt",
    );

    expect(defaultWorkflow).toEqual(
      expect.objectContaining({
        name: "aop-default-gpt",
        source: "builtin",
        active: true,
        stepCount: expect.any(Number),
      }),
    );
    expect(defaultWorkflow?.steps[0]).toEqual(
      expect.objectContaining({
        id: "implement",
        type: "implement",
      }),
    );
    expect(defaultWorkflow?.steps[0]?.agent).toEqual({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "low",
      fastMode: true,
    });
    expect(defaultWorkflow?.steps[0]?.transitions).toContainEqual({
      condition: "success",
      target: "run-tests",
    });
  });

  test("returns step library blocks for the workflow builder", async () => {
    const result = await listStepLibrary(ctx.workflowService);
    const reviewBlock = result.steps.find((step) => step.id === "code_review");

    expect(reviewBlock).toEqual(
      expect.objectContaining({
        id: "code_review",
        category: "general",
        promptTemplate: "code-review-step.md.hbs",
      }),
    );
    expect(reviewBlock?.promptContent).toContain("You are reviewing code changes");
    expect(result.steps.some((step) => step.id === "implement_page")).toBe(true);
    expect(result.steps.some((step) => step.id === "run-tests")).toBe(true);
    expect(result.steps.some((step) => step.id === "run_tests")).toBe(false);
  });

  test("hides stale custom blocks that reuse retired built-in ids", async () => {
    await db
      .insertInto("workflow_skill_blocks")
      .values({
        id: "run_tests",
        type: "test",
        category: "general",
        description: "Legacy duplicate run-tests block",
        signals: JSON.stringify([{ name: "TASK_COMPLETE", description: "done" }]),
        prompt_template: "run-tests.md.hbs",
        defaults: JSON.stringify({ maxAttempts: 15 }),
        agent: null,
        source: "user",
      })
      .execute();

    const result = await listStepLibrary(ctx.workflowService);
    const legacyRunTestsBlocks = result.steps.filter((step) => step.id === "run_tests");
    const runTestsBlock = result.steps.find((step) => step.id === "run-tests");

    expect(legacyRunTestsBlocks).toHaveLength(0);
    expect(runTestsBlock).toEqual(
      expect.objectContaining({
        id: "run-tests",
        source: "builtin",
        promptTemplate: "run-tests.md.hbs",
      }),
    );
    expect(runTestsBlock?.promptContent).toContain("You are running tests");
  });

  test("rejects custom blocks that reuse a retired built-in id", async () => {
    await expect(
      createSkillBlock(ctx.workflowService, {
        id: "run_tests",
        type: "test",
        category: "general",
        description: "Duplicate run-tests block",
        signals: [{ name: "TESTS_PASS", description: "tests pass" }],
        promptTemplate: "Run the tests.",
        defaults: { maxAttempts: 1 },
      }),
    ).rejects.toThrow('Step block id "run_tests" is retired; use "run-tests"');
  });

  test("creates a user workflow from selected step library blocks", async () => {
    const result = await createWorkflowFromSteps(ctx.workflowService, {
      name: "frontend-polish",
      stepIds: ["codebase_research", "code_review", "run-tests"],
    });

    expect(result.workflow).toEqual(
      expect.objectContaining({
        name: "frontend-polish",
        source: "user",
        stepCount: 3,
      }),
    );

    const persisted = await ctx.workflowRepository.findByName("frontend-polish");
    const definition = persisted ? JSON.parse(persisted.definition) : null;

    expect(persisted?.active).toBe(true);
    expect(definition.initialStep).toBe("codebase_research");
    expect(definition.steps.code_review.transitions).toContainEqual({
      condition: "success",
      target: "run-tests",
    });
  });

  test("deletes user-created step blocks from the API", async () => {
    await createSkillBlock(ctx.workflowService, {
      id: "temporary_review",
      type: "review",
      category: "general",
      description: "Temporary review block",
      signals: [{ name: "REVIEW_DONE", description: "review completed" }],
      promptTemplate: "Review the diff.",
      defaults: { maxAttempts: 2 },
    });

    await ctx.workflowService.deleteSkillBlock("temporary_review");

    const library = await listStepLibrary(ctx.workflowService);
    expect(library.steps.some((step) => step.id === "temporary_review")).toBe(false);
  });

  test("rejects deleting built-in step blocks", async () => {
    await expect(ctx.workflowService.deleteSkillBlock("code_review")).rejects.toThrow(
      'Built-in step block "code_review" cannot be deleted',
    );
  });

  test("deletes user workflows but rejects built-ins", async () => {
    await seedBuiltInFixture("aop-default-gpt");
    await createWorkflowFromSteps(ctx.workflowService, {
      name: "temporary-workflow",
      stepIds: ["run-tests"],
    });
    const service = ctx.workflowService as unknown as {
      deleteWorkflow?: (id: string) => Promise<void>;
    };

    expect(typeof service.deleteWorkflow).toBe("function");
    const temporary = await ctx.workflowRepository.findByName("temporary-workflow");
    await service.deleteWorkflow?.(temporary?.id ?? "");
    expect((await listWorkflows(ctx.workflowService)).workflows).not.toContain(
      "temporary-workflow",
    );

    const builtIn = await ctx.workflowRepository.findByName("aop-default-gpt");
    await expect(service.deleteWorkflow?.(builtIn?.id ?? "")).rejects.toThrow(
      'Built-in workflow "aop-default-gpt" cannot be deleted',
    );
  });

  test("creates custom step blocks without persisting runtime settings", async () => {
    const legacyInput: CreateSkillBlockInput & {
      agent: {
        provider: "codex-cli";
        model: string;
        reasoning: "medium";
        fastMode: true;
      };
    } = {
      id: "quick_ui_review",
      type: "review",
      category: "frontend",
      description: "Review the UI for obvious regressions",
      signals: [{ name: "REVIEW_DONE", description: "review completed" }],
      promptTemplate: "Look at the latest UI changes and report visual issues.",
      defaults: { maxAttempts: 2 },
      agent: {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "medium",
        fastMode: true,
      },
    };
    const created = await createSkillBlock(ctx.workflowService, legacyInput);

    const library = await listStepLibrary(ctx.workflowService);
    const savedBlock = library.steps.find((step) => step.id === "quick_ui_review");

    expect(created.step.id).toBe("quick_ui_review");
    expect(created.step.agent).toBeUndefined();
    expect(savedBlock).toEqual(
      expect.objectContaining({
        id: "quick_ui_review",
        source: "user",
        defaults: { maxAttempts: 2 },
        promptContent: "Look at the latest UI changes and report visual issues.",
      }),
    );
    expect(savedBlock?.agent).toBeUndefined();

    await createWorkflowFromSteps(ctx.workflowService, {
      name: "review-without-step-runtime",
      steps: [{ skillId: "quick_ui_review" }],
    });
    const persisted = await ctx.workflowRepository.findByName("review-without-step-runtime");
    const definition = persisted ? JSON.parse(persisted.definition) : null;
    expect(definition.steps.quick_ui_review.agent).toBeUndefined();
  });

  test("does not auto-import local machine skills into the step library", async () => {
    localSkillRoot = createLocalSkillRoot({
      "release-checklist": `---
name: release-checklist
description: Check release readiness before handoff.
---

# Release Checklist

Use when a release needs readiness checks.
`,
    });
    process.env.AOP_WORKFLOW_SKILL_ROOTS = localSkillRoot;

    const library = await listStepLibrary(ctx.workflowService);

    expect(library.steps.some((step) => step.id.startsWith("local_"))).toBe(false);
  });

  test("creates a workflow from a user-defined step block with imported skill prompt", async () => {
    await createSkillBlock(ctx.workflowService, {
      id: "imported_code_review",
      type: "review",
      category: "general",
      description: "Review implementation changes for risks and missing tests.",
      signals: [{ name: "REVIEW_DONE", description: "review completed" }],
      promptTemplate: "# Code Review\n\nReview the diff and report issues.",
      defaults: { maxAttempts: 5 },
    });

    await createWorkflowFromSteps(ctx.workflowService, {
      name: "custom-review",
      steps: [
        {
          skillId: "imported_code_review",
          maxAttempts: 5,
          agent: {
            provider: "codex-cli",
            model: "gpt-5.5",
            reasoning: "high",
            fastMode: true,
          },
        },
      ],
    });

    const persisted = await ctx.workflowRepository.findByName("custom-review");
    const definition = persisted ? JSON.parse(persisted.definition) : null;

    expect(definition.initialStep).toBe("imported_code_review");
    expect(definition.steps.imported_code_review).toEqual(
      expect.objectContaining({
        id: "imported_code_review",
        type: "review",
        maxAttempts: 5,
        promptTemplate: expect.stringContaining("inline:# Code Review"),
        agent: {
          provider: "codex-cli",
          model: "gpt-5.5",
          reasoning: "high",
          fastMode: true,
        },
      }),
    );
  });

  test("creates a user workflow with per-step retries and runtime config", async () => {
    await createSkillBlock(ctx.workflowService, {
      id: "quick_ui_review",
      type: "review",
      category: "frontend",
      description: "Review the UI for obvious regressions",
      signals: [{ name: "REVIEW_DONE", description: "review completed" }],
      promptTemplate: "Look at the latest UI changes and report visual issues.",
      defaults: { maxAttempts: 2 },
    });

    const result = await createWorkflowFromSteps(ctx.workflowService, {
      name: "frontend-polish",
      steps: [
        {
          skillId: "codebase_research",
          maxAttempts: 4,
          agent: {
            provider: "codex-cli",
            model: "gpt-5.5",
            reasoning: "high",
            fastMode: true,
          },
        },
        {
          skillId: "quick_ui_review",
          id: "quick_ui_review_final",
          maxAttempts: 3,
          agent: {
            provider: "opencode",
            model: "opencode-go/kimi-k2.7-code",
            reasoning: "medium",
            fastMode: false,
          },
        },
      ],
    });

    const persisted = await ctx.workflowRepository.findByName("frontend-polish");
    const definition = persisted ? JSON.parse(persisted.definition) : null;

    expect(result.workflow.stepCount).toBe(2);
    expect(definition.initialStep).toBe("codebase_research");
    expect(definition.steps.codebase_research.maxAttempts).toBe(4);
    expect(definition.steps.codebase_research.agent).toEqual({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: true,
    });
    expect(definition.steps.quick_ui_review_final).toEqual(
      expect.objectContaining({
        id: "quick_ui_review_final",
        maxAttempts: 3,
        promptTemplate: "inline:Look at the latest UI changes and report visual issues.",
        agent: {
          provider: "opencode",
          model: "opencode-go/kimi-k2.7-code",
          reasoning: "medium",
          fastMode: false,
        },
      }),
    );
  });

  test("creates a user workflow with OpenCode step runtime config", async () => {
    const result = await createWorkflowFromSteps(ctx.workflowService, {
      name: "opencode-flow",
      steps: [
        {
          skillId: "codebase_research",
          maxAttempts: 2,
          agent: {
            provider: "opencode",
            model: "openai/gpt-5.5",
            reasoning: "medium",
          },
        },
      ],
    });

    const persisted = await ctx.workflowRepository.findByName("opencode-flow");
    const definition = persisted ? JSON.parse(persisted.definition) : null;

    expect(result.workflow.stepCount).toBe(1);
    expect(definition.steps.codebase_research.agent).toEqual({
      provider: "opencode",
      model: "openai/gpt-5.5",
      reasoning: "medium",
    });
  });

  test("creates a user workflow with explicit transition routing", async () => {
    const result = await createWorkflowFromSteps(ctx.workflowService, {
      name: "review-loop",
      steps: [
        {
          id: "build",
          skillId: "implement",
          transitions: [
            { condition: "TASK_COMPLETE", target: "review" },
            { condition: "CHUNK_DONE", target: "build" },
            { condition: "failure", target: "__blocked__" },
          ],
        },
        {
          id: "review",
          skillId: "code_review",
          transitions: [
            { condition: "REVIEW_PASSED", target: "__done__" },
            {
              condition: "REVIEW_FAILED",
              target: "build",
              maxIterations: 2,
              onMaxIterations: "__blocked__",
            },
            { condition: "failure", target: "__blocked__" },
          ],
        },
      ],
    });

    const persisted = await ctx.workflowRepository.findByName("review-loop");
    const definition = persisted ? JSON.parse(persisted.definition) : null;

    expect(result.workflow.stepCount).toBe(2);
    expect(definition.steps.review.transitions).toContainEqual({
      condition: "REVIEW_FAILED",
      target: "build",
      maxIterations: 2,
      onMaxIterations: "__blocked__",
    });
  });

  test("edits a built-in workflow as a user override while preserving routing", async () => {
    await seedBuiltInFixture("aop-default-gpt");
    const details = await listWorkflowDetails(ctx.workflowService);
    const defaultWorkflow = details.workflows.find(
      (workflow) => workflow.name === "aop-default-gpt",
    );
    if (!defaultWorkflow) {
      throw new Error("aop-default-gpt should be synced");
    }

    const result = await createWorkflowFromSteps(ctx.workflowService, {
      sourceWorkflowId: defaultWorkflow.id,
      name: "aop-default-gpt",
      steps: defaultWorkflow.steps.map((step) => ({
        id: step.id,
        skillId: step.id,
        maxAttempts: step.id === "implement" ? 3 : step.maxAttempts,
        agent:
          step.id === "run-tests"
            ? {
                provider: "codex-cli",
                model: "gpt-5.5",
                reasoning: "high",
                fastMode: true,
              }
            : step.agent,
      })),
    });

    const persisted = await ctx.workflowRepository.findByName("aop-default-gpt");
    const definition = persisted ? JSON.parse(persisted.definition) : null;

    expect(result.workflow).toEqual(
      expect.objectContaining({
        id: defaultWorkflow.id,
        name: "aop-default-gpt",
        source: "user",
      }),
    );
    expect(definition.steps.implement.maxAttempts).toBe(3);
    expect(definition.steps.implement.transitions).toContainEqual({
      condition: "success",
      target: "run-tests",
    });
    expect(definition.steps["run-tests"].agent.reasoning).toBe("high");
    expect(definition.steps["run-tests"].transitions).toContainEqual({
      condition: "TESTS_FAIL",
      target: "debug-failures",
      maxIterations: 5,
      onMaxIterations: "__blocked__",
    });
  });

  test("persists canvas layout when saving a workflow", async () => {
    const result = await createWorkflowFromSteps(ctx.workflowService, {
      name: "layout-save-test",
      steps: [
        {
          skillId: "codebase_research",
        },
        {
          skillId: "run-tests",
          id: "run-tests",
        },
      ],
      canvas: {
        version: 1,
        nodes: {
          codebase_research: { x: 40, y: 60 },
          "run-tests": { x: 420, y: 180 },
          __done__: { x: 900, y: 120 },
          __blocked__: { x: 900, y: 40 },
        },
      },
    });

    const persisted = await ctx.workflowRepository.findByName("layout-save-test");
    const definition = persisted ? JSON.parse(persisted.definition) : null;

    expect(result.workflow.canvas).toEqual({
      version: 1,
      nodes: {
        codebase_research: { x: 40, y: 60 },
        "run-tests": { x: 420, y: 180 },
        __done__: { x: 900, y: 120 },
        __blocked__: { x: 900, y: 40 },
      },
    });
    expect(definition.canvas).toEqual(result.workflow.canvas);
  });

  test("persists canvas edge handle connections when saving a workflow", async () => {
    const result = await createWorkflowFromSteps(ctx.workflowService, {
      name: "layout-edge-handles-test",
      steps: [
        {
          skillId: "codebase_research",
        },
        {
          skillId: "run-tests",
          id: "run-tests",
        },
      ],
      canvas: {
        version: 1,
        nodes: {
          codebase_research: { x: 40, y: 60 },
          "run-tests": { x: 420, y: 180 },
        },
        edges: {
          "route-1": { sourceHandle: "bottom", targetHandle: "top" },
        },
      },
    });

    const persisted = await ctx.workflowRepository.findByName("layout-edge-handles-test");
    const definition = persisted ? JSON.parse(persisted.definition) : null;

    expect(result.workflow.canvas?.edges).toEqual({
      "route-1": { sourceHandle: "bottom", targetHandle: "top" },
    });
    expect(definition.canvas?.edges).toEqual(result.workflow.canvas?.edges);
  });

  test("rejects fast mode on non-Codex workflow steps", async () => {
    await expect(
      createWorkflowFromSteps(ctx.workflowService, {
        name: "unsafe-fast-mode",
        steps: [
          {
            skillId: "codebase_research",
            agent: {
              provider: "claude-code",
              model: "claude-opus-4-6",
              reasoning: "medium",
              fastMode: true,
            },
          },
        ],
      }),
    ).rejects.toThrow(
      "Fast mode is only available for Claude Opus 5, Codex CLI, and PI Codex models",
    );
  });
});

const createLocalSkillRoot = (skills: Record<string, string>): string => {
  const root = join(tmpdir(), `aop-local-skills-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });

  for (const [directory, markdown] of Object.entries(skills)) {
    const skillDir = join(root, directory);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), markdown);
  }

  return root;
};
