import { describe, expect, test } from "bun:test";
import type { RuntimeConfigurationProvider, RuntimePreference } from "@aop/common";
import { effortLabel, effortOptions, modelLabel, modelOptions } from "./runtime-options";

const preference = (overrides: Partial<RuntimePreference> = {}): RuntimePreference => ({
  provider: "claude-code",
  model: null,
  effort: "low",
  ...overrides,
});

const configuration = (
  models: { model: string; description: string; levels: string[]; isDefault?: boolean }[],
): RuntimeConfigurationProvider =>
  ({
    id: "cfg_1",
    name: "Fake CLI",
    command: "/bin/fake",
    driver: "claude-code",
    builtIn: false,
    position: 0,
    supportsFastMode: false,
    models: models.map((model, position) => ({
      id: `m_${position}`,
      providerId: "cfg_1",
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
  test("offers the models of the first runnable configuration, the ones a run would use", () => {
    const options = modelOptions("claude-code", [
      configuration([]),
      configuration([
        {
          model: "fake-model",
          description: "Fake model",
          levels: ["low", "high"],
          isDefault: true,
        },
        { model: "other", description: "", levels: ["medium"] },
      ]),
    ]);

    expect(options).toEqual([
      { model: "fake-model", label: "Fake model", efforts: ["low", "high"], isDefault: true },
      { model: "other", label: "other", efforts: ["medium"], isDefault: false },
    ]);
  });

  test("falls back to the provider's built-in catalog when nothing is configured", () => {
    const options = modelOptions("claude-code", []);

    expect(options.length).toBeGreaterThan(1);
    expect(options[0]?.isDefault).toBe(true);
    expect(options.every((option) => option.efforts.length > 0)).toBe(true);
  });
});

describe("effortOptions", () => {
  const options = modelOptions("claude-code", [
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
  const options = modelOptions("claude-code", [
    configuration([{ model: "a", description: "Model A", levels: ["low"], isDefault: true }]),
  ]);

  test("say default for a preference that names nothing, and the model's own name otherwise", () => {
    expect(modelLabel(preference(), options)).toBe("Default model");
    expect(modelLabel(preference({ model: "a" }), options)).toBe("Model A");
    expect(modelLabel(preference({ model: "claude-opus-5" }), options)).toBe("Opus 5");
    expect(effortLabel(preference({ effort: null }))).toBe("Default effort");
    expect(effortLabel(preference({ effort: "high" }))).toBe("High");
  });
});
