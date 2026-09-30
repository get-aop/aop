import { describe, expect, test } from "bun:test";
import {
  CliProviderSchema,
  ReasoningEffortSchema,
  RuntimePreferenceSchema,
  RuntimeSelectionSchema,
} from "./runtime.ts";
import { makeRuntimeSelection, parsed, rejectedPaths } from "./test-utils.ts";

describe("CliProviderSchema", () => {
  test.each(["claude-code", "codex-cli", "pi"])("accepts %s", (provider) => {
    expect(CliProviderSchema.parse(provider)).toBe(provider);
  });

  test.each(["grok-build", "opencode", "hermes", "openclaw", ""])("rejects %p", (provider) => {
    expect(CliProviderSchema.safeParse(provider).success).toBe(false);
  });
});

describe("ReasoningEffortSchema", () => {
  test("accepts the normalized scale", () => {
    for (const effort of ["low", "medium", "high", "extra-high", "max"]) {
      expect(parsed(ReasoningEffortSchema, effort)).toBe(effort);
    }
  });

  test("rejects values outside the scale", () => {
    expect(ReasoningEffortSchema.safeParse("ultra").success).toBe(false);
  });
});

describe("RuntimeSelectionSchema", () => {
  test("accepts a fully resolved selection", () => {
    expect(parsed(RuntimeSelectionSchema, makeRuntimeSelection())).toEqual(makeRuntimeSelection());
  });

  test("requires a concrete model and effort", () => {
    expect(rejectedPaths(RuntimeSelectionSchema, makeRuntimeSelection({ model: null }))).toEqual([
      "model",
    ]);
    expect(rejectedPaths(RuntimeSelectionSchema, makeRuntimeSelection({ effort: null }))).toEqual([
      "effort",
    ]);
  });

  test.each(["--dangerously-skip-permissions", "gpt 5.5", "", "model;rm -rf /"])(
    "rejects model %p, which could read as a flag or split into several arguments",
    (model) => {
      expect(rejectedPaths(RuntimeSelectionSchema, makeRuntimeSelection({ model }))).toEqual([
        "model",
      ]);
    },
  );

  test("accepts provider model ids with dots, colons, slashes, and a bracket suffix", () => {
    for (const model of ["gpt-5.5", "anthropic/claude-opus-5", "claude-opus-5[1m]", "llama3:70b"]) {
      expect(RuntimeSelectionSchema.safeParse(makeRuntimeSelection({ model })).success).toBe(true);
    }
  });
});

describe("RuntimePreferenceSchema", () => {
  test("null model and effort mean use the provider default", () => {
    const preference = { provider: "codex-cli", model: null, effort: null };
    expect(parsed(RuntimePreferenceSchema, preference)).toEqual(preference);
  });

  test("still requires a provider and validates a model when one is set", () => {
    expect(rejectedPaths(RuntimePreferenceSchema, { model: null, effort: null })).toEqual([
      "provider",
    ]);
    expect(
      rejectedPaths(RuntimePreferenceSchema, { provider: "pi", model: "-x", effort: null }),
    ).toEqual(["model"]);
  });
});
