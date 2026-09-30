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
      model: null,
      effort,
    });
    const modelOnly = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
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
      model: offered.model,
      effort: offered.thinkingLevels[1] ?? null,
    });
    const unknownModel = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      model: "not-a-model",
      effort: null,
    });
    const unofferedEffort = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
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

  test("uses the first runnable runtime configuration, so a fake or aliased CLI wins when ordered first", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
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
    const others = (await configurations.list())
      .map(({ id }) => id)
      .filter((id) => id !== custom.id);
    await configurations.reorderProviders([custom.id, ...others]);

    const onDefault = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      model: null,
      effort: null,
    });
    const named = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
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
});
