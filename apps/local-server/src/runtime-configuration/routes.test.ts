import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  formatRuntimeModelLabel,
  getRuntimeModelOptions,
  getThinkingOptions,
  type RuntimeConfigurationProvider,
  runtimeSupportsFastMode,
} from "@aop/common";
import { FAKE_CLI_PATH } from "@aop/llm-provider/test-fixtures";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createRuntimeConfigurationRoutes } from "./routes.ts";

const BASE = "/api/runtime-configuration";

describe("runtime configuration routes", () => {
  let db: Kysely<Database>;
  let app: Hono;

  beforeEach(async () => {
    db = await createTestDb();
    app = new Hono();
    app.route(BASE, createRuntimeConfigurationRoutes(createCommandContext(db)));
  });

  afterEach(async () => {
    await db.destroy();
  });

  const listProviders = async (): Promise<RuntimeConfigurationProvider[]> => {
    const response = await app.request(BASE);
    return ((await response.json()) as { providers: RuntimeConfigurationProvider[] }).providers;
  };

  const send = (method: string, path: string, body?: unknown) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  test("seeds Claude Code as the only built-in runtime", async () => {
    const providers = await listProviders();

    expect(providers.map((provider) => provider.id)).toEqual(["claude-code"]);
    const [claude] = providers;
    expect(claude).toMatchObject({
      name: "Claude Code",
      command: "claude",
      driver: "claude-code",
      builtIn: true,
    });
    expect(claude?.models.every((model) => model.builtIn)).toBe(true);
  });

  test("keeps the built-in runtime aligned with the shared runtime catalog", async () => {
    const [claude] = await listProviders();
    if (!claude) throw new Error("Expected the Claude Code built-in");

    expect(claude.models.map((model) => model.model)).toEqual([
      ...getRuntimeModelOptions("claude-code"),
    ]);
    for (const model of claude.models) {
      expect(model.description).toBe(formatRuntimeModelLabel(model.model));
      expect(model.thinkingLevels).toEqual(
        getThinkingOptions("claude-code", model.model).map((option) => option.value),
      );
    }
    expect(claude.supportsFastMode).toBe(runtimeSupportsFastMode("claude-code"));
  });

  test("exposes Max effort only on the Claude models that accept it", async () => {
    const [claude] = await listProviders();
    const levels = (model: string) =>
      claude?.models.find((item) => item.model === model)?.thinkingLevels;

    expect(levels("claude-opus-5")).toEqual(["low", "medium", "high", "extra-high", "max"]);
    expect(levels("claude-sonnet-4-6")).toEqual(["low", "medium", "high", "extra-high"]);
  });

  test("promotes previously custom catalog models to built-in on reseed", async () => {
    await db
      .insertInto("runtime_configuration_providers")
      .values({
        id: "claude-code",
        name: "Claude Code",
        command: "claude",
        driver: "claude-code",
        built_in: true,
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await db
      .insertInto("runtime_configuration_models")
      .values({
        id: "rtmodel_custom_claude_fable",
        provider_id: "claude-code",
        description: "Fable custom",
        model: "claude-fable-5",
        thinking_levels: JSON.stringify([]),
        fast_mode: false,
        built_in: false,
        position: 9,
        is_default: true,
      })
      .execute();

    const [claude] = await listProviders();
    const fable = claude?.models.find((model) => model.model === "claude-fable-5");

    expect(fable).toEqual(
      expect.objectContaining({
        description: "Fable 5",
        builtIn: true,
        thinkingLevels: ["low", "medium", "high", "extra-high", "max"],
        position: 4,
        isDefault: true,
      }),
    );
  });

  test("clones Claude Code as an editable custom provider", async () => {
    const cloneResponse = await send("POST", "/providers/claude-code/clone", {
      name: "Work Claude",
      command: "claude",
      driver: "claude-code",
    });

    expect(cloneResponse.status).toBe(201);
    const { provider } = (await cloneResponse.json()) as { provider: RuntimeConfigurationProvider };
    expect(provider).toMatchObject({ name: "Work Claude", builtIn: false });
    expect(provider.models).toContainEqual(
      expect.objectContaining({ description: "Fable 5", model: "claude-fable-5", builtIn: false }),
    );

    const updateResponse = await send("PATCH", `/providers/${provider.id}`, {
      name: "Edited Claude",
      command: "claude-work",
      driver: "claude-code",
    });

    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual({
      provider: expect.objectContaining({ name: "Edited Claude", command: "claude-work" }),
    });
  });

  test("binds a custom command to a Claude Code provider for the fake CLI seam", async () => {
    const providerResponse = await send("POST", "/providers", {
      name: "Fake CLI",
      command: FAKE_CLI_PATH,
      driver: "claude-code",
    });
    expect(providerResponse.status).toBe(201);
    const { provider } = (await providerResponse.json()) as {
      provider: RuntimeConfigurationProvider;
    };

    const modelResponse = await send("POST", `/providers/${provider.id}/models`, {
      description: "Fake model",
      model: "fake-model",
      thinkingLevels: [],
    });
    expect(modelResponse.status).toBe(201);

    const registered = (await listProviders()).find((item) => item.id === provider.id);
    expect(registered).toMatchObject({
      command: FAKE_CLI_PATH,
      driver: "claude-code",
      builtIn: false,
      models: [expect.objectContaining({ model: "fake-model", thinkingLevels: [] })],
    });
  });

  test("defaults a provider without a driver to claude-code", async () => {
    const response = await send("POST", "/providers", { name: "CC Personal", command: "cpe" });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      provider: expect.objectContaining({ command: "cpe", driver: "claude-code" }),
    });
  });

  test("a refused provider says which field is wrong, in plain words", async () => {
    const tooLong = await send("POST", "/providers", { name: "n".repeat(61), command: "other" });

    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "Name can be at most 60 characters." });
  });

  test.each(["codex-cli", "pi", "grok-build", "opencode", "custom"])(
    "rejects a provider with the %s driver",
    async (driver) => {
      const body = { name: "Other", command: "other", driver };

      expect((await send("POST", "/providers", body)).status).toBe(400);
      expect((await send("POST", "/providers/claude-code/clone", body)).status).toBe(400);
      expect((await send("PATCH", "/providers/claude-code", body)).status).toBe(400);
      expect((await listProviders()).map((provider) => provider.id)).toEqual(["claude-code"]);
    },
  );

  test("accepts arbitrary models for a Claude Code command alias", async () => {
    const providerResponse = await send("POST", "/providers", {
      name: "CC Personal",
      command: "cpe",
      driver: "claude-code",
    });
    const { provider } = (await providerResponse.json()) as {
      provider: RuntimeConfigurationProvider;
    };

    const modelResponse = await send("POST", `/providers/${provider.id}/models`, {
      description: "Vendor Sol Fast",
      model: "vendor/sol-fast",
      thinkingLevels: ["high", "max"],
    });

    expect(modelResponse.status).toBe(201);
    expect(await modelResponse.json()).toEqual({
      model: expect.objectContaining({ model: "vendor/sol-fast" }),
    });
  });

  test("reorders providers and toggles has-fast-mode at the runtime level", async () => {
    await listProviders();
    const created = await send("POST", "/providers", {
      name: "CC Personal",
      command: "cpe",
      driver: "claude-code",
    });
    const { provider: custom } = (await created.json()) as {
      provider: RuntimeConfigurationProvider;
    };
    const providers = await listProviders();
    const claude = providers.find((provider) => provider.id === "claude-code");
    expect(claude?.supportsFastMode).toBe(true);

    const reversed = providers.map((provider) => provider.id).reverse();
    expect(reversed).toEqual([custom.id, "claude-code"]);
    const reorderResponse = await send("PUT", "/providers/order", { providerIds: reversed });
    expect(reorderResponse.status).toBe(200);
    const reordered = (await reorderResponse.json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    expect(reordered.providers.map((provider) => provider.id)).toEqual(reversed);

    const supportsResponse = await send("PATCH", "/providers/claude-code/supports-fast", {
      supportsFastMode: false,
    });
    expect(supportsResponse.status).toBe(200);
    expect(await supportsResponse.json()).toEqual({
      provider: expect.objectContaining({ supportsFastMode: false }),
    });
  });

  test("returns not found when adding a model to a missing provider", async () => {
    const response = await send("POST", "/providers/rtprov_missing/models", {
      description: "Missing",
      model: "missing/model",
      thinkingLevels: [],
    });

    expect(response.status).toBe(404);
  });

  test("returns conflict for duplicate provider names", async () => {
    const input = { name: "Work Claude", command: "claude-work", driver: "claude-code" };

    expect((await send("POST", "/providers", input)).status).toBe(201);
    expect((await send("POST", "/providers", input)).status).toBe(409);
  });

  test("returns conflict for duplicate model identifiers within a provider", async () => {
    await listProviders();
    const response = await send("POST", "/providers/claude-code/models", {
      description: "Duplicate Opus 5",
      model: "claude-opus-5",
      thinkingLevels: ["high"],
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Model already exists for this provider" });
  });

  test("persists model order and returns it from every configuration read", async () => {
    const [claude] = await listProviders();
    if (!claude || claude.models.length < 2) throw new Error("Expected Claude models");
    const reversedIds = claude.models.map((model) => model.id).reverse();

    const response = await send("PUT", "/providers/claude-code/models/order", {
      modelIds: reversedIds,
    });

    expect(response.status).toBe(200);
    const { provider } = (await response.json()) as { provider: RuntimeConfigurationProvider };
    expect(provider.models.map((model) => model.id)).toEqual(reversedIds);
    const [refreshed] = await listProviders();
    expect(refreshed?.models.map((model) => model.id)).toEqual(reversedIds);
  });

  test("sets one default model per provider and allows clearing it", async () => {
    const [claude] = await listProviders();
    const preferred = claude?.models[1];
    if (!preferred) throw new Error("Expected a second Claude model");

    const response = await send("PATCH", `/models/${preferred.id}/default`, { isDefault: true });

    expect(response.status).toBe(200);
    const { provider } = (await response.json()) as { provider: RuntimeConfigurationProvider };
    expect(provider.models.filter((model) => model.isDefault).map((model) => model.id)).toEqual([
      preferred.id,
    ]);

    const clearResponse = await send("PATCH", `/models/${preferred.id}/default`, {
      isDefault: false,
    });
    const cleared = (await clearResponse.json()) as { provider: RuntimeConfigurationProvider };
    expect(cleared.provider.models.some((model) => model.isDefault)).toBe(false);
  });

  test("sets default thinking level for a model", async () => {
    const [claude] = await listProviders();
    const model = claude?.models[0];
    if (!model) throw new Error("Expected a Claude model");
    expect(model.thinkingLevels).toContain("high");

    const response = await send("PATCH", `/models/${model.id}/default-thinking`, {
      defaultThinkingLevel: "high",
    });

    expect(response.status).toBe(200);
    const { provider } = (await response.json()) as { provider: RuntimeConfigurationProvider };
    expect(provider.models.find((item) => item.id === model.id)?.defaultThinkingLevel).toBe("high");

    const invalid = await send("PATCH", `/models/${model.id}/default-thinking`, {
      defaultThinkingLevel: "not-a-level",
    });
    expect(invalid.status).toBe(400);
  });
});
