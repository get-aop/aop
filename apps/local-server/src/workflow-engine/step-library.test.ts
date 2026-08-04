import { describe, expect, test } from "bun:test";
import { getStepBlock, STEP_LIBRARY, STEP_LIBRARY_MAP } from "./step-library.ts";
import { StepType } from "./types.ts";

const VALID_STEP_TYPES = new Set(Object.values(StepType));

const IRON_CLAW_STEP_IDS = [
  "codebase_research",
  "run-tests",
  "seo_audit",
  "code_review",
  "market_analysis",
  "add_differentiator",
];

const AOP_DEFAULT_PIPELINE_STEP_IDS = [
  "implement",
  "run-tests",
  "debug-failures",
  "simplification",
  "improve-architecture",
  "nuclear_review",
  "fix-issues",
  "quick-review",
];

const REQUIRES_INPUT_STEP_IDS = ["visual_verify", "design_brief", "outline_page", "write_copy"];

describe("Step Library", () => {
  test("contains composable and aop-default-gpt pipeline step blocks", () => {
    expect(STEP_LIBRARY).toHaveLength(22);
  });

  test("exposes shared read-only audit and security review blocks", () => {
    expect(getStepBlock("audit")).toMatchObject({
      type: "review",
      promptTemplate: "audit.md.hbs",
      signals: [{ name: "AUDIT_PASSED" }, { name: "AUDIT_FAILED" }],
    });
    expect(getStepBlock("security-review")).toMatchObject({
      type: "review",
      promptTemplate: "security-review.md.hbs",
      signals: [{ name: "SECURITY_PASSED" }, { name: "SECURITY_FAILED" }],
    });
  });

  test("exposes Implement Page and only the canonical Run Tests block", () => {
    expect(getStepBlock("implement_page")).toMatchObject({
      id: "implement_page",
      type: "implement",
      category: "frontend",
      promptTemplate: "implement-frontend.md.hbs",
    });
    expect(getStepBlock("run_tests")).toBeUndefined();
    expect(getStepBlock("run-tests")).toBeDefined();
    expect(
      STEP_LIBRARY.filter((block) => block.promptTemplate === "run-tests.md.hbs"),
    ).toHaveLength(1);
  });

  test("exposes Browser Control and Computer Control blocks with capability defaults", () => {
    expect(getStepBlock("browser_control")).toMatchObject({
      id: "browser_control",
      type: "implement",
      category: "general",
      promptTemplate: "browser-control.md.hbs",
      agent: {
        provider: "codex-cli",
        browserControl: true,
        computerControl: false,
      },
    });
    expect(getStepBlock("computer_control")).toMatchObject({
      id: "computer_control",
      type: "implement",
      category: "general",
      promptTemplate: "computer-control.md.hbs",
      agent: {
        provider: "codex-cli",
        browserControl: false,
        computerControl: true,
      },
    });
    expect(getStepBlock("browser_control")?.description.toLowerCase()).toContain("browser");
    expect(getStepBlock("computer_control")?.description.toLowerCase()).toContain("computer");
  });

  test("retired step blocks are no longer in the library", () => {
    for (const id of [
      "implement_backend",
      "implement_frontend",
      "run_tests",
      "address_feedback",
      "full-review",
      "debug_systematic",
      "cleanup-review",
      "review",
    ]) {
      expect(getStepBlock(id)).toBeUndefined();
    }
  });

  test("includes aop-default-gpt pipeline blocks", () => {
    for (const id of AOP_DEFAULT_PIPELINE_STEP_IDS) {
      expect(getStepBlock(id)).toBeDefined();
    }
  });

  test("simplification appears exactly once, sourced from the pipeline blocks", () => {
    expect(STEP_LIBRARY.filter((block) => block.id === "simplification")).toHaveLength(1);
    expect(getStepBlock("simplification")).toMatchObject({
      id: "simplification",
      type: "review",
      category: "general",
      promptTemplate: "simplification.md.hbs",
    });
    expect(getStepBlock("nuclear_review")).toMatchObject({
      id: "nuclear_review",
      type: "review",
      category: "general",
      promptTemplate: "nuclear-review.md.hbs",
    });
  });

  test("does not include retired intake-only workflow blocks", () => {
    expect(getStepBlock("planning_cli_plan")).toBeUndefined();
    expect(getStepBlock("human_in_loop")).toBeUndefined();
    expect(getStepBlock("lifecycle_mark_ready")).toBeUndefined();
  });

  test("does not register iterate as a step block id", () => {
    expect(getStepBlock("iterate")).toBeUndefined();
    expect(getStepBlock("implement")?.promptTemplate).toBe("implement.md.hbs");
    expect(getStepBlock("implement")?.type).toBe("implement");
  });

  test("the implement block does not expose chunking signals", () => {
    expect(getStepBlock("implement")?.signals.map((signal) => signal.name)).toEqual([]);
  });

  test("all step block IDs are unique", () => {
    const ids = STEP_LIBRARY.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("all step block types are valid StepType values", () => {
    for (const block of STEP_LIBRARY) {
      expect(VALID_STEP_TYPES.has(block.type)).toBe(true);
    }
  });

  test("all step blocks have a promptTemplate ending in .md.hbs", () => {
    for (const block of STEP_LIBRARY) {
      expect(block.promptTemplate).toMatch(/\.md\.hbs$/);
    }
  });

  test("all step blocks have at least one signal except signal-less implement steps", () => {
    for (const block of STEP_LIBRARY) {
      if (block.signals.length === 0) {
        expect(block.signals).toEqual([]);
        continue;
      }
      expect(block.signals.length).toBeGreaterThan(0);
    }
  });

  test("implement blocks do not expose chunk completion signals", () => {
    for (const block of STEP_LIBRARY.filter((candidate) => candidate.type === "implement")) {
      expect(block.signals.map((signal) => signal.name)).not.toContain("CHUNK_DONE");
      expect(block.signals.map((signal) => signal.name)).not.toContain("ALL_TASKS_DONE");
    }
  });

  test("all step blocks have positive maxAttempts", () => {
    for (const block of STEP_LIBRARY) {
      expect(block.defaults.maxAttempts).toBeGreaterThan(0);
    }
  });

  describe("Iron Claw rule", () => {
    test("Iron Claw blocks do not include REQUIRES_INPUT", () => {
      for (const id of IRON_CLAW_STEP_IDS) {
        const block = getStepBlock(id);
        expect(block).toBeDefined();
        expect(block?.signals.map((s) => s.name)).not.toContain("REQUIRES_INPUT");
      }
    });
  });

  describe("REQUIRES_INPUT steps", () => {
    test("only expected steps include REQUIRES_INPUT", () => {
      const stepsWithRequiresInput = STEP_LIBRARY.filter((b) =>
        b.signals.some((s) => s.name === "REQUIRES_INPUT"),
      ).map((b) => b.id);
      expect(stepsWithRequiresInput.sort()).toEqual([...REQUIRES_INPUT_STEP_IDS].sort());
    });
  });

  describe("STEP_LIBRARY_MAP", () => {
    test("maps all step blocks by id", () => {
      expect(STEP_LIBRARY_MAP.size).toBe(STEP_LIBRARY.length);
      for (const block of STEP_LIBRARY) {
        expect(STEP_LIBRARY_MAP.get(block.id)).toBe(block);
      }
    });
  });

  describe("getStepBlock", () => {
    test("returns block for valid id", () => {
      expect(getStepBlock("codebase_research")).toBeDefined();
      expect(getStepBlock("codebase_research")?.type).toBe("research");
    });

    test("returns undefined for unknown id", () => {
      expect(getStepBlock("nonexistent")).toBeUndefined();
    });
  });
});
