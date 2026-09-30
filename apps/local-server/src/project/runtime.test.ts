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

  test("a setting with no model and no effort resolves to the built-in runtime's own defaults", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
    const [builtIn] = await configurations.list();
    const defaultModel = builtIn?.models.find((model) => model.isDefault) ?? builtIn?.models[0];

    const runtime = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      model: null,
      effort: null,
    });

    expect(runtime).toMatchObject({
      runtime: "claude-code",
      runtimeConfigurationId: builtIn?.id,
      runtimeAlias: "claude",
      model: defaultModel?.model,
    });
    expect(defaultModel?.thinkingLevels).toContain(runtime.reasoningEffort as never);
  });

  test("keeps a model and an effort the runtime offers, and falls back for ones it does not", async () => {
    const configurations = createRuntimeConfigurationRepository(db);
    const [builtIn] = await configurations.list();
    const offered = builtIn?.models.find((model) => model.thinkingLevels.length > 1);
    if (!offered)
      throw new Error("the built-in runtime should offer a model with several effort levels");
    const modelDefault = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      model: offered.model,
      effort: null,
    });
    const notTheDefault = offered.thinkingLevels.find(
      (level) => level !== modelDefault.reasoningEffort,
    );

    const kept = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      model: offered.model,
      effort: notTheDefault ?? null,
    });
    const unknownModel = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      model: "not-a-model",
      effort: null,
    });

    expect(notTheDefault).toBeDefined();
    expect(kept).toMatchObject({ model: offered.model, reasoningEffort: notTheDefault });
    expect(unknownModel.model).not.toBe("not-a-model");
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

    const runtime = await resolveSessionRuntime(configurations, {
      provider: "claude-code",
      model: null,
      effort: "high",
    });

    expect(runtime).toEqual({
      runtime: "claude-code",
      runtimeConfigurationId: custom.id,
      runtimeAlias: "/opt/bin/my-claude",
      model: "custom-model",
      reasoningEffort: "medium",
    });
  });
});
