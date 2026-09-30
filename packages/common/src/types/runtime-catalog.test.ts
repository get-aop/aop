import { describe, expect, test } from "bun:test";
import {
  CLI_PROVIDER_LABELS,
  CLI_PROVIDER_OPTIONS,
  formatRuntimeModelLabel,
  getDefaultRuntimeModel,
  getDefaultRuntimeReasoning,
  getRuntimeModelOptions,
  getThinkingLabel,
  getThinkingOptions,
  isAllowedRuntimeModel,
  isCliProvider,
  isSafeCustomRuntimeModel,
  supportsFastMode,
} from "./runtime-catalog.ts";

describe("runtime catalog", () => {
  test("exposes Claude Code as the only runtime", () => {
    expect(CLI_PROVIDER_OPTIONS).toEqual([{ value: "claude-code", label: "Claude Code" }]);
    expect(CLI_PROVIDER_LABELS).toEqual({ "claude-code": "Claude Code" });
  });

  test("rejects runtimes outside the catalog", () => {
    expect(isCliProvider("claude-code")).toBe(true);
    for (const provider of ["codex-cli", "pi", "grok-build", "opencode", "e2e-fixture", ""]) {
      expect(isCliProvider(provider)).toBe(false);
    }
  });

  test("validates the claude-code model list", () => {
    expect(getRuntimeModelOptions("claude-code")).toEqual([
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-fable-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
    expect(isAllowedRuntimeModel("claude-code", "claude-opus-5")).toBe(true);
    expect(isAllowedRuntimeModel("claude-code", "claude-haiku-4-5")).toBe(true);
    expect(isAllowedRuntimeModel("claude-code", "claude-fable-4-6")).toBe(false);
    expect(isAllowedRuntimeModel("claude-code", "gpt-5.5")).toBe(false);
    expect(isAllowedRuntimeModel("claude-code", "default")).toBe(false);
  });

  test("labels models and falls back to the raw id for unknown ones", () => {
    expect(formatRuntimeModelLabel("claude-haiku-4-5")).toBe("Haiku 4.5");
    expect(formatRuntimeModelLabel("claude-fable-5")).toBe("Fable 5");
    expect(formatRuntimeModelLabel("vendor/custom-model:v2")).toBe("vendor/custom-model:v2");
  });

  test("accepts safe custom model identifiers and rejects unsafe ones", () => {
    expect(isSafeCustomRuntimeModel("vendor/custom-model:v2")).toBe(true);
    expect(isSafeCustomRuntimeModel("claude-opus-5[1m]")).toBe(true);
    expect(isSafeCustomRuntimeModel("claude-opus-5 [1m]")).toBe(false);
    expect(isSafeCustomRuntimeModel("custom model --dangerous")).toBe(false);
    expect(isSafeCustomRuntimeModel("default")).toBe(false);
    expect(getDefaultRuntimeModel("claude-code", "vendor/custom-model:v2")).toBe(
      "vendor/custom-model:v2",
    );
  });

  test("falls back to the first catalog model for an unusable model", () => {
    expect(getDefaultRuntimeModel("claude-code", "")).toBe("claude-opus-5");
    expect(getDefaultRuntimeModel("claude-code", "default")).toBe("claude-opus-5");
    expect(getDefaultRuntimeModel("claude-code", "claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
});

describe("effort levels", () => {
  test("uses Claude's own effort labels", () => {
    expect(getThinkingOptions("claude-code", "claude-opus-4-8")).toEqual([
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "extra-high", label: "Extra" },
      { value: "max", label: "Max" },
    ]);
    expect(getThinkingLabel("claude-code", "extra-high")).toBe("Extra");
  });

  test("exposes Max only for Opus 5, Opus 4.8 and Fable", () => {
    for (const model of ["claude-opus-5", "claude-opus-4-8", "claude-fable-5"]) {
      expect(getThinkingOptions("claude-code", model).map((o) => o.value)).toContain("max");
    }
    for (const model of ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5", "custom-x"]) {
      expect(getThinkingOptions("claude-code", model).map((o) => o.value)).toEqual([
        "low",
        "medium",
        "high",
        "extra-high",
      ]);
    }
  });

  test("keeps a valid current effort and otherwise prefers extra-high", () => {
    expect(getDefaultRuntimeReasoning("claude-code", "claude-opus-4-8", "max")).toBe("max");
    expect(getDefaultRuntimeReasoning("claude-code", "claude-sonnet-4-6", "max")).toBe(
      "extra-high",
    );
  });

  test("keeps the current effort for a custom model outside the catalog", () => {
    expect(getDefaultRuntimeReasoning("claude-code", "vendor/custom:v2", "max")).toBe("max");
  });
});

describe("fast mode", () => {
  test("is available only on Claude Opus 5", () => {
    expect(supportsFastMode("claude-code", "claude-opus-5")).toBe(true);
    expect(supportsFastMode("claude-code", "claude-opus-4-8")).toBe(false);
    expect(supportsFastMode("claude-code", "gpt-5.5")).toBe(false);
  });
});
