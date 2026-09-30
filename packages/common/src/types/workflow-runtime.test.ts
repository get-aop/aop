import { describe, expect, test } from "bun:test";
import {
  applyWorkflowRuntimeProviderDefaults,
  formatWorkflowRuntimeModelLabel,
  getDefaultWorkflowRuntimeModel,
  getDefaultWorkflowRuntimeReasoning,
  getWorkflowModelOptions,
  getWorkflowThinkingLabel,
  getWorkflowThinkingOptions,
  isAllowedWorkflowRuntimeModel,
  isSafeCustomRuntimeModel,
  isWorkflowRuntimeProvider,
  supportsFastMode,
  WORKFLOW_RUNTIME_LABELS,
  WORKFLOW_RUNTIME_OPTIONS,
} from "./workflow-runtime.ts";

describe("runtime catalog", () => {
  test("exposes Claude Code as the only runtime", () => {
    expect(WORKFLOW_RUNTIME_OPTIONS).toEqual([{ value: "claude-code", label: "Claude Code" }]);
    expect(WORKFLOW_RUNTIME_LABELS).toEqual({ "claude-code": "Claude Code" });
  });

  test("rejects runtimes outside the catalog", () => {
    expect(isWorkflowRuntimeProvider("claude-code")).toBe(true);
    for (const provider of ["codex-cli", "pi", "grok-build", "opencode", "e2e-fixture", ""]) {
      expect(isWorkflowRuntimeProvider(provider)).toBe(false);
    }
  });

  test("validates the claude-code model list", () => {
    expect(getWorkflowModelOptions("claude-code")).toEqual([
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-fable-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-opus-5")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-haiku-4-5")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-fable-4-6")).toBe(false);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "gpt-5.5")).toBe(false);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "default")).toBe(false);
  });

  test("labels models and falls back to the raw id for unknown ones", () => {
    expect(formatWorkflowRuntimeModelLabel("claude-haiku-4-5")).toBe("Haiku 4.5");
    expect(formatWorkflowRuntimeModelLabel("claude-fable-5")).toBe("Fable 5");
    expect(formatWorkflowRuntimeModelLabel("vendor/custom-model:v2")).toBe(
      "vendor/custom-model:v2",
    );
  });

  test("accepts safe custom model identifiers and rejects unsafe ones", () => {
    expect(isSafeCustomRuntimeModel("vendor/custom-model:v2")).toBe(true);
    expect(isSafeCustomRuntimeModel("claude-opus-5[1m]")).toBe(true);
    expect(isSafeCustomRuntimeModel("claude-opus-5 [1m]")).toBe(false);
    expect(isSafeCustomRuntimeModel("custom model --dangerous")).toBe(false);
    expect(isSafeCustomRuntimeModel("default")).toBe(false);
    expect(getDefaultWorkflowRuntimeModel("claude-code", "vendor/custom-model:v2")).toBe(
      "vendor/custom-model:v2",
    );
  });

  test("falls back to the first catalog model for an unusable model", () => {
    expect(getDefaultWorkflowRuntimeModel("claude-code", "")).toBe("claude-opus-5");
    expect(getDefaultWorkflowRuntimeModel("claude-code", "default")).toBe("claude-opus-5");
    expect(getDefaultWorkflowRuntimeModel("claude-code", "claude-haiku-4-5")).toBe(
      "claude-haiku-4-5",
    );
  });
});

describe("effort levels", () => {
  test("uses Claude's own effort labels", () => {
    expect(getWorkflowThinkingOptions("claude-code", "claude-opus-4-8")).toEqual([
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "extra-high", label: "Extra" },
      { value: "max", label: "Max" },
    ]);
    expect(getWorkflowThinkingLabel("claude-code", "extra-high")).toBe("Extra");
  });

  test("exposes Max only for Opus 5, Opus 4.8 and Fable", () => {
    for (const model of ["claude-opus-5", "claude-opus-4-8", "claude-fable-5"]) {
      expect(getWorkflowThinkingOptions("claude-code", model).map((o) => o.value)).toContain("max");
    }
    for (const model of ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5", "custom-x"]) {
      expect(getWorkflowThinkingOptions("claude-code", model).map((o) => o.value)).toEqual([
        "low",
        "medium",
        "high",
        "extra-high",
      ]);
    }
  });

  test("keeps a valid current effort and otherwise prefers extra-high", () => {
    expect(getDefaultWorkflowRuntimeReasoning("claude-code", "claude-opus-4-8", "max")).toBe("max");
    expect(getDefaultWorkflowRuntimeReasoning("claude-code", "claude-sonnet-4-6", "max")).toBe(
      "extra-high",
    );
  });

  test("keeps the current effort for a custom model outside the catalog", () => {
    expect(getDefaultWorkflowRuntimeReasoning("claude-code", "vendor/custom:v2", "max")).toBe(
      "max",
    );
  });
});

describe("fast mode", () => {
  test("is available only on Claude Opus 5", () => {
    expect(supportsFastMode("claude-code", "claude-opus-5")).toBe(true);
    expect(supportsFastMode("claude-code", "claude-opus-4-8")).toBe(false);
    expect(supportsFastMode("claude-code", "gpt-5.5")).toBe(false);
  });
});

describe("applyWorkflowRuntimeProviderDefaults", () => {
  test("keeps a valid model, effort, Fast mode and ultracode", () => {
    expect(
      applyWorkflowRuntimeProviderDefaults(
        {
          provider: "claude-code",
          model: "claude-opus-5",
          reasoning: "max",
          fastMode: true,
          ultracode: true,
        },
        "claude-code",
      ),
    ).toEqual({
      provider: "claude-code",
      model: "claude-opus-5",
      reasoning: "max",
      fastMode: true,
      ultracode: true,
    });
  });

  test("drops Fast mode on a model without it and fills the defaults", () => {
    expect(
      applyWorkflowRuntimeProviderDefaults(
        { provider: "claude-code", model: "claude-opus-4-8", reasoning: "medium", fastMode: true },
        "claude-code",
      ),
    ).toEqual({
      provider: "claude-code",
      model: "claude-opus-4-8",
      reasoning: "medium",
      fastMode: false,
      ultracode: false,
    });
  });

  test("keeps a trimmed runtime alias and drops a blank one", () => {
    const base = { provider: "claude-code", model: "claude-opus-5", reasoning: "high" } as const;
    expect(
      applyWorkflowRuntimeProviderDefaults({ ...base, runtimeAlias: "  cpe  " }, "claude-code")
        .runtimeAlias,
    ).toBe("cpe");
    expect(
      applyWorkflowRuntimeProviderDefaults({ ...base, runtimeAlias: "   " }, "claude-code"),
    ).not.toHaveProperty("runtimeAlias");
  });

  test("keeps browser control but forces computer control off", () => {
    const result = applyWorkflowRuntimeProviderDefaults(
      {
        provider: "claude-code",
        model: "claude-opus-5",
        reasoning: "high",
        browserControl: true,
        computerControl: true,
      },
      "claude-code",
    );
    expect(result.browserControl).toBe(true);
    expect(result.computerControl).toBe(false);
  });

  test("adds no control fields when none were set", () => {
    const result = applyWorkflowRuntimeProviderDefaults(
      { provider: "claude-code", model: "claude-opus-5", reasoning: "high" },
      "claude-code",
    );
    expect(result).not.toHaveProperty("browserControl");
    expect(result).not.toHaveProperty("computerControl");
  });
});
