import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { resolveSessionRuntime } from "./runtime.ts";

describe("resolveSessionRuntime", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("a setting with no model and no effort stays on the CLI's default: nothing is chosen for it", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
    const [builtIn] = await configurations.list();

    const runtime = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      runtimeId: "claude-code",
      model: null,
      effort: null,
    });

    expect(runtime).toEqual({
      runtime: "claude-code",
      runtimeConfigurationId: builtIn?.id ?? null,
      runtimeAlias: "claude",
      model: null,
      reasoningEffort: null,
    });
  });

  test("a model or an effort left on default does not depend on the other", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
    const [builtIn] = await configurations.list();
    const offered = builtIn?.models.find((model) => model.thinkingLevels.length > 1);
    if (!offered)
      throw new Error("the built-in runtime should offer a model with several effort levels");
    const effort = offered.thinkingLevels[0] ?? null;

    const effortOnly = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      runtimeId: "claude-code",
      model: null,
      effort,
    });
    const modelOnly = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      runtimeId: "claude-code",
      model: offered.model,
      effort: null,
    });

    expect(effortOnly).toMatchObject({ model: null, reasoningEffort: effort });
    expect(modelOnly).toMatchObject({ model: offered.model, reasoningEffort: null });
  });

  test("keeps a model and an effort the runtime offers, and falls back for ones it does not", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
    const [builtIn] = await configurations.list();
    const offered = builtIn?.models.find((model) => model.thinkingLevels.length > 1);
    const defaultModel = builtIn?.models.find((model) => model.isDefault) ?? builtIn?.models[0];
    if (!offered || !defaultModel) {
      throw new Error("the built-in runtime should offer a model with several effort levels");
    }
    const kept = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      runtimeId: "claude-code",
      model: offered.model,
      effort: offered.thinkingLevels[1] ?? null,
    });
    const unknownModel = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      runtimeId: "claude-code",
      model: "not-a-model",
      effort: null,
    });
    const unofferedEffort = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      runtimeId: "claude-code",
      model: offered.model,
      effort: "ultra" as never,
    });

    expect(kept).toMatchObject({
      model: offered.model,
      reasoningEffort: offered.thinkingLevels[1],
    });
    expect(unknownModel.model).toBe(defaultModel.model);
    expect(offered.thinkingLevels).toContain(unofferedEffort.reasoningEffort as never);
  });

  test("runs on the runtime the project names, wherever it sits in the order", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
    const custom = await createCustomRuntime(configurations);

    const onDefault = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      runtimeId: custom.id,
      model: null,
      effort: null,
    });
    const named = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      runtimeId: custom.id,
      model: "custom-model",
      effort: "high",
    });

    expect(onDefault).toEqual({
      runtime: "claude-code",
      runtimeConfigurationId: custom.id,
      runtimeAlias: "/opt/bin/my-claude",
      model: null,
      reasoningEffort: null,
    });
    expect(named).toEqual({
      runtime: "claude-code",
      runtimeConfigurationId: custom.id,
      runtimeAlias: "/opt/bin/my-claude",
      model: "custom-model",
      // The model lists no effort levels, so the effort asked for has nothing to apply to.
      reasoningEffort: null,
    });
  });

  test("a custom runtime placed first no longer wins over the one a project names", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
    const custom = await createCustomRuntime(configurations);
    const others = (await configurations.list())
      .map(({ id }) => id)
      .filter((id) => id !== custom.id);
    await configurations.reorderProviders([custom.id, ...others]);

    const runtime = await resolveSessionRuntime(configurations, onRuntime("claude-code"));

    expect(runtime).toMatchObject({
      runtimeConfigurationId: "claude-code",
      runtimeAlias: "claude",
    });
  });

  test("a runtime that is gone falls back to the host's default, then to the built-in one", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
    const hostDefault = await createCustomRuntime(configurations);

    const toDefault = await resolveSessionRuntime(
      configurations,
      onRuntime("rtprov_removed"),
      hostDefault.id,
    );
    const toBuiltIn = await resolveSessionRuntime(
      configurations,
      onRuntime("rtprov_removed"),
      "rtprov_also_removed",
    );

    expect(toDefault.runtimeConfigurationId).toBe(hostDefault.id);
    expect(toBuiltIn).toMatchObject({
      runtimeConfigurationId: "claude-code",
      runtimeAlias: "claude",
    });
  });

  test("a runtime with no models cannot run a turn, so the role falls back", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
    const empty = await configurations.createProvider({
      name: "No models",
      command: "/opt/bin/empty",
      driver: "claude-code",
    });

    const runtime = await resolveSessionRuntime(configurations, onRuntime(empty.id));

    expect(runtime.runtimeConfigurationId).toBe("claude-code");
  });
});

const onRuntime = (runtimeId: string) => ({
  provider: "claude-code" as const,
  runtimeId,
  model: null,
  effort: null,
});

const createCustomRuntime = async (
  configurations: ReturnType<typeof createRuntimeConfigurationRepository>,
) => {
  const custom = await configurations.createProvider({
    name: "My claude",
    command: "/opt/bin/my-claude",
    driver: "claude-code",
  });
  await configurations.createModel(custom.id, {
    description: "Custom",
    model: "custom-model",
    thinkingLevels: [],
  });
  return custom;
};
