import { describe, expect, test } from "bun:test";
import {
  findRuntimeConfiguration,
  getDefaultRuntimeConfigurationModel,
  normalizeDefaultThinkingLevel,
  RuntimeConfigurationModelInputSchema,
  type RuntimeConfigurationProvider,
  RuntimeConfigurationProviderInputSchema,
  resolveConfiguredModelRecord,
  resolveRuntimeConfigurationReasoning,
  runtimeConfigurationSupportsFastMode,
  runtimeSupportsFastMode,
} from "./runtime-configuration.ts";

describe("runtime configuration", () => {
  test("enables Claude Code fast mode for Opus 5 runtimes", () => {
    expect(runtimeSupportsFastMode("claude-code")).toBe(true);
    expect(
      runtimeConfigurationSupportsFastMode(
        {
          driver: "claude-code",
          builtIn: true,
          supportsFastMode: false,
        },
        "claude-opus-5",
      ),
    ).toBe(true);
    expect(
      runtimeConfigurationSupportsFastMode(
        {
          driver: "claude-code",
          builtIn: true,
          supportsFastMode: true,
        },
        "claude-opus-4-8",
      ),
    ).toBe(false);
  });

  test("allows models without configurable thinking", () => {
    expect(
      RuntimeConfigurationModelInputSchema.safeParse({
        description: "Fake model",
        model: "fake-model",
        thinkingLevels: [],
      }).success,
    ).toBe(true);
  });

  test("allows bracketed context-window model ids like claude-opus-5[1m]", () => {
    expect(
      RuntimeConfigurationModelInputSchema.safeParse({
        description: "Opus 5 (1M)",
        model: "claude-opus-5[1m]",
        thinkingLevels: [],
      }).success,
    ).toBe(true);
  });

  test("still rejects model ids with whitespace or shell metacharacters", () => {
    for (const model of ["k3 [1m]", "k3;rm -rf /", "$(whoami)"]) {
      expect(
        RuntimeConfigurationModelInputSchema.safeParse({
          description: "Bad",
          model,
          thinkingLevels: [],
        }).success,
      ).toBe(false);
    }
  });

  test("requires provider commands to be a single executable token", () => {
    expect(
      RuntimeConfigurationProviderInputSchema.safeParse({
        name: "Work Claude",
        command: "claude --profile work",
        driver: "claude-code",
      }).success,
    ).toBe(false);
    expect(
      RuntimeConfigurationProviderInputSchema.safeParse({
        name: "Work Claude",
        command: "claude-work",
        driver: "claude-code",
      }).success,
    ).toBe(true);
  });

  test("defaults the driver to claude-code and rejects drivers outside the catalog", () => {
    expect(
      RuntimeConfigurationProviderInputSchema.parse({ name: "Work Claude", command: "cpe" }).driver,
    ).toBe("claude-code");
    for (const driver of ["codex-cli", "pi", "grok-build", "opencode", "custom"]) {
      expect(
        RuntimeConfigurationProviderInputSchema.safeParse({
          name: "Other",
          command: "other",
          driver,
        }).success,
      ).toBe(false);
    }
  });

  test("resolves the flagged default model before the first model", () => {
    expect(
      getDefaultRuntimeConfigurationModel([
        { model: "first", isDefault: false },
        { model: "preferred", isDefault: true },
      ]),
    ).toEqual({ model: "preferred", isDefault: true });
    expect(
      getDefaultRuntimeConfigurationModel([
        { model: "first", isDefault: false },
        { model: "second", isDefault: false },
      ]),
    ).toEqual({ model: "first", isDefault: false });
  });

  test("prefers configured default thinking over a still-valid current value", () => {
    expect(resolveRuntimeConfigurationReasoning(["low", "high", "max"], "max", "high")).toBe(
      "high",
    );
    expect(resolveRuntimeConfigurationReasoning(["low", "high", "max"], "medium", "high")).toBe(
      "high",
    );
    expect(resolveRuntimeConfigurationReasoning(["low", "high"], "medium", null)).toBe("low");
    expect(resolveRuntimeConfigurationReasoning(["low", "high"], "high", "max")).toBe("high");
  });

  test("normalizes default thinking to an enabled level", () => {
    expect(normalizeDefaultThinkingLevel(["low", "high"], "high")).toBe("high");
    expect(normalizeDefaultThinkingLevel(["low", "high"], "max")).toBe("low");
    expect(normalizeDefaultThinkingLevel([], "high")).toBe(null);
  });

  test("findRuntimeConfiguration prefers exact id then ordered driver/match filters", () => {
    const model = (
      providerId: string,
      id: string,
    ): RuntimeConfigurationProvider["models"][number] => ({
      id,
      providerId,
      description: "Opus 5",
      model: "claude-opus-5",
      thinkingLevels: ["low", "high"],
      builtIn: false,
      position: 0,
      isDefault: true,
      defaultThinkingLevel: "high",
    });
    const configurations: RuntimeConfigurationProvider[] = [
      {
        id: "claude-code",
        name: "Claude Code",
        command: "claude",
        driver: "claude-code",
        builtIn: true,
        position: 0,
        supportsFastMode: true,
        models: [model("claude-code", "m1")],
      },
      {
        id: "rtprov_cpe",
        name: "CPE",
        command: "cpe",
        driver: "claude-code",
        builtIn: false,
        position: 1,
        supportsFastMode: false,
        models: [model("rtprov_cpe", "m2")],
      },
      {
        id: "rtprov_empty",
        name: "No models",
        command: "empty",
        driver: "claude-code",
        builtIn: false,
        position: 2,
        supportsFastMode: false,
        models: [],
      },
    ];

    expect(findRuntimeConfiguration(configurations, { preferredId: "rtprov_cpe" })?.id).toBe(
      "rtprov_cpe",
    );
    expect(findRuntimeConfiguration(configurations, { driver: "claude-code" })?.id).toBe(
      "claude-code",
    );
    expect(
      findRuntimeConfiguration(configurations, {
        driver: "claude-code",
        match: (item) => item.command === "cpe",
      })?.id,
    ).toBe("rtprov_cpe");
    expect(
      findRuntimeConfiguration(configurations, { match: (item) => item.id === "rtprov_empty" }),
    ).toBeUndefined();
    expect(resolveConfiguredModelRecord(configurations[0], "missing")?.model).toBe("claude-opus-5");
  });
});
