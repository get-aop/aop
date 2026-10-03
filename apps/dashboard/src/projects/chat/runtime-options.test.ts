import { describe, expect, test } from "bun:test";
import type { RuntimeConfigurationProvider, RuntimePreference } from "@aop/common";
import {
  changeModel,
  changeRuntime,
  defaultEffortLabel,
  defaultModelLabel,
  effortLabel,
  effortOptions,
  modelLabel,
  modelOptions,
  runtimeChoices,
} from "./runtime-options";

const preference = (overrides: Partial<RuntimePreference> = {}): RuntimePreference => ({
  provider: "claude-code",
  runtimeId: "claude-code",
  model: null,
  effort: "low",
  ...overrides,
});

const configuration = (
  models: { model: string; description: string; levels: string[]; isDefault?: boolean }[],
  id = "cfg_1",
): RuntimeConfigurationProvider =>
  ({
    id,
    name: `Runtime ${id}`,
    command: "/bin/fake",
    driver: "claude-code",
    builtIn: false,
    position: 0,
    supportsFastMode: false,
    models: models.map((model, position) => ({
      id: `m_${position}`,
      providerId: id,
      builtIn: false,
      position,
      isDefault: model.isDefault ?? false,
      defaultThinkingLevel: null,
      description: model.description,
      model: model.model,
      thinkingLevels: model.levels,
    })),
  }) as RuntimeConfigurationProvider;

describe("modelOptions", () => {
  test("offers the models of the runtime the role names, whatever comes first", () => {
    const options = modelOptions("cfg_2", [
      configuration([{ model: "first", description: "First", levels: ["low"] }], "cfg_1"),
      configuration(
        [
          {
            model: "fake-model",
            description: "Fake model",
            levels: ["low", "high"],
            isDefault: true,
          },
          { model: "other", description: "", levels: ["medium"] },
        ],
        "cfg_2",
      ),
    ]);

    expect(options).toEqual([
      { model: "fake-model", label: "Fake model", efforts: ["low", "high"], isDefault: true },
      { model: "other", label: "other", efforts: ["medium"], isDefault: false },
    ]);
  });

  test("falls back to the built-in catalog while runtimes load or for one that is gone", () => {
    for (const configurations of [[], [configuration([], "cfg_1")]]) {
      const options = modelOptions("cfg_1", configurations);

      expect(options.length).toBeGreaterThan(1);
      expect(options[0]?.isDefault).toBe(true);
      expect(options.every((option) => option.efforts.length > 0)).toBe(true);
    }
  });
});

describe("runtimeChoices", () => {
  const runtimes = [configuration([], "claude-code"), configuration([], "cfg_2")];

  test("offers none while the host's first look is on its way, and all it has no status for", () => {
    expect(runtimeChoices(runtimes, null).map((choice) => choice.ready)).toEqual([false, false]);
    expect(runtimeChoices(runtimes, null)[0]?.reason).toBe("Checking whether it can run…");
    expect(runtimeChoices(runtimes, {}).map((choice) => choice.ready)).toEqual([true, true]);
  });

  test("a runtime the host found not ready carries the reason", () => {
    const statuses = {
      cfg_2: {
        runtimeId: "cfg_2",
        path: null,
        version: null,
        auth: "unknown" as const,
        ready: false,
        reason: "The command `x` was not found on this host's PATH.",
        checkedAt: "2026-10-03T00:00:00.000Z",
      },
    };

    expect(runtimeChoices(runtimes, statuses)).toEqual([
      { id: "claude-code", name: "Runtime claude-code", ready: true, reason: null },
      {
        id: "cfg_2",
        name: "Runtime cfg_2",
        ready: false,
        reason: "The command `x` was not found on this host's PATH.",
      },
    ]);
  });
});

describe("changeRuntime", () => {
  const runtimes = [
    configuration(
      [{ model: "a", description: "A", levels: ["low", "high"], isDefault: true }],
      "cfg_1",
    ),
    configuration([{ model: "b", description: "B", levels: ["medium"], isDefault: true }], "cfg_2"),
  ];

  test("moves the role, back to the default model, keeping an effort the new runtime accepts", () => {
    const from = preference({ runtimeId: "cfg_2", model: "b", effort: "low" });

    expect(changeRuntime(from, "cfg_1", runtimes)).toEqual(
      preference({ runtimeId: "cfg_1", model: null, effort: "low" }),
    );
  });

  test("drops an effort the new runtime's default model does not accept", () => {
    const from = preference({ runtimeId: "cfg_1", model: "a", effort: "high" });

    expect(changeRuntime(from, "cfg_2", runtimes)).toEqual(
      preference({ runtimeId: "cfg_2", model: null, effort: null }),
    );
  });
});

describe("changeModel", () => {
  const options = modelOptions("cfg_1", [
    configuration([
      { model: "a", description: "A", levels: ["low"], isDefault: true },
      { model: "b", description: "B", levels: ["high"] },
    ]),
  ]);

  test("keeps the effort only if the new model accepts it", () => {
    expect(changeModel(preference({ effort: "low" }), "a", options).effort).toBe("low");
    expect(changeModel(preference({ effort: "low" }), "b", options).effort).toBeNull();
  });
});

describe("effortOptions", () => {
  const options = modelOptions("cfg_1", [
    configuration([
      { model: "a", description: "A", levels: ["low", "medium"], isDefault: true },
      { model: "b", description: "B", levels: ["high", "max"] },
    ]),
  ]);

  test("are the efforts of the model the preference names", () => {
    expect(effortOptions(preference({ model: "b" }), options).map(({ value }) => value)).toEqual([
      "high",
      "max",
    ]);
  });

  test("are those of the default model when none is named, or when the named one is unknown", () => {
    expect(effortOptions(preference(), options).map(({ value }) => value)).toEqual([
      "low",
      "medium",
    ]);
    expect(effortOptions(preference({ model: "gone" }), options).map(({ value }) => value)).toEqual(
      ["low", "medium"],
    );
  });
});

describe("labels", () => {
  const options = modelOptions("cfg_1", [
    configuration([{ model: "a", description: "Model A", levels: ["low"], isDefault: true }]),
  ]);

  test("say default for a preference that names nothing, and the model's own name otherwise", () => {
    expect(modelLabel(preference(), options)).toBe("Default model");
    expect(modelLabel(preference({ model: "a" }), options)).toBe("Model A");
    expect(modelLabel(preference({ model: "claude-opus-5" }), options)).toBe("Opus 5");
    expect(effortLabel(preference({ effort: null }))).toBe("Default effort");
    expect(effortLabel(preference({ effort: "high" }))).toBe("High");
  });

  test("on default, name what the role's last run reported, and say plain Default before one did", () => {
    const reported = { model: "claude-opus-5-5", effort: "low" as const };
    const nothing = { model: null, effort: null };

    expect(modelLabel(preference(), options, reported)).toBe("Opus 5.5");
    expect(modelLabel(preference(), options, { model: "a", effort: null })).toBe("Model A");
    expect(modelLabel(preference({ model: "a" }), options, reported)).toBe("Model A");
    expect(effortLabel(preference({ effort: null }), reported)).toBe("Low");
    expect(effortLabel(preference({ effort: "high" }), reported)).toBe("High");

    expect(defaultModelLabel(reported)).toBe("Default (Opus 5.5)");
    expect(defaultModelLabel(nothing)).toBe("Default");
    expect(defaultEffortLabel("claude-code", reported)).toBe("Default (Low)");
    expect(defaultEffortLabel("claude-code", nothing)).toBe("Default");
  });
});
