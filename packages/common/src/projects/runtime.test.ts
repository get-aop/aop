import { describe, expect, test } from "bun:test";
import { CliProviderSchema, ReasoningEffortSchema, RuntimePreferenceSchema } from "./runtime.ts";
import { makeRuntimePreference, parsed, rejectedPaths } from "./test-utils.ts";

describe("CliProviderSchema", () => {
  test("accepts claude-code, the only Phase 1 runtime", () => {
    expect(CliProviderSchema.parse("claude-code")).toBe("claude-code");
  });

  test.each(["codex-cli", "pi", "grok-build", "opencode", "hermes", "openclaw", ""])(
    "rejects %p",
    (provider) => {
      expect(CliProviderSchema.safeParse(provider).success).toBe(false);
    },
  );
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

describe("RuntimePreferenceSchema", () => {
  test("accepts a role that names its model and effort", () => {
    expect(parsed(RuntimePreferenceSchema, makeRuntimePreference())).toEqual(
      makeRuntimePreference(),
    );
  });

  test("null model and effort mean use the provider default, each on its own", () => {
    for (const overrides of [{ model: null, effort: null }, { model: null }, { effort: null }]) {
      const preference = makeRuntimePreference(overrides);
      expect(parsed(RuntimePreferenceSchema, preference)).toEqual(preference);
    }
  });

  test("still requires a provider", () => {
    expect(rejectedPaths(RuntimePreferenceSchema, { model: null, effort: null })).toEqual([
      "provider",
    ]);
  });

  test("validates a model and an effort when one is set", () => {
    expect(rejectedPaths(RuntimePreferenceSchema, makeRuntimePreference({ model: "-x" }))).toEqual([
      "model",
    ]);
    expect(
      rejectedPaths(RuntimePreferenceSchema, makeRuntimePreference({ effort: "ultra" })),
    ).toEqual(["effort"]);
  });

  test.each(["--dangerously-skip-permissions", "gpt 5.5", "", "model;rm -rf /"])(
    "rejects model %p, which could read as a flag or split into several arguments",
    (model) => {
      expect(rejectedPaths(RuntimePreferenceSchema, makeRuntimePreference({ model }))).toEqual([
        "model",
      ]);
    },
  );

  test("accepts provider model ids with dots, colons, slashes, and a bracket suffix", () => {
    for (const model of ["gpt-5.5", "anthropic/claude-opus-5", "claude-opus-5[1m]", "llama3:70b"]) {
      expect(RuntimePreferenceSchema.safeParse(makeRuntimePreference({ model })).success).toBe(
        true,
      );
    }
  });
});
