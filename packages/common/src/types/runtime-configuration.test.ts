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
        description: "Kimi",
        model: "opencode-go/kimi-k2.7-code",
        thinkingLevels: [],
      }).success,
    ).toBe(true);
  });

  test("allows bracketed vendor model ids like Kimi k3[1m]", () => {
    expect(
      RuntimeConfigurationModelInputSchema.safeParse({
        description: "Kimi K3 (1M)",
        model: "k3[1m]",
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
    const configurations: RuntimeConfigurationProvider[] = [
      {
        id: "rtprov_pi",
        name: "PI",
        command: "pi",
        driver: "pi",
        builtIn: true,
        position: 0,
        supportsFastMode: true,
        models: [
          {
            id: "m1",
            providerId: "rtprov_pi",
            description: "Sol",
            model: "openai-codex/gpt-5.6-sol",
            thinkingLevels: ["low", "high"],
            builtIn: true,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "high",
          },
        ],
      },
      {
        id: "rtprov_omp",
        name: "OMP",
        command: "omp",
        driver: "pi",
        builtIn: false,
        position: 1,
        supportsFastMode: false,
        models: [
          {
            id: "m2",
            providerId: "rtprov_omp",
            description: "Sol OMP",
            model: "openai-codex/gpt-5.6-sol",
            thinkingLevels: ["medium"],
            builtIn: false,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "medium",
          },
        ],
      },
    ];

    expect(findRuntimeConfiguration(configurations, { preferredId: "rtprov_omp" })?.id).toBe(
      "rtprov_omp",
    );
    expect(findRuntimeConfiguration(configurations, { driver: "pi" })?.id).toBe("rtprov_pi");
    expect(
      findRuntimeConfiguration(configurations, {
        driver: "pi",
        match: (item) => item.command === "omp",
      })?.id,
    ).toBe("rtprov_omp");
    expect(resolveConfiguredModelRecord(configurations[0], "missing")?.model).toBe(
      "openai-codex/gpt-5.6-sol",
    );
  });
});
