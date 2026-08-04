import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getWorkflowModelOptions,
  getWorkflowThinkingOptions,
  type RuntimeConfigurationProvider,
  runtimeSupportsFastMode,
  supportsThinkingLevel,
  type WorkflowRuntimeProvider,
} from "@aop/common";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createRuntimeConfigurationRoutes } from "./routes.ts";

describe("runtime configuration routes", () => {
  let db: Kysely<Database>;
  let app: Hono;

  beforeEach(async () => {
    db = await createTestDb();
    app = new Hono();
    app.route(
      "/api/runtime-configuration",
      createRuntimeConfigurationRoutes(createCommandContext(db)),
    );
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("seeds GPT 5.6 OpenCode models as built-ins", async () => {
    const response = await app.request("/api/runtime-configuration");
    const { providers } = (await response.json()) as {
      providers: Array<{
        id: string;
        models: Array<{ model: string; builtIn: boolean }>;
      }>;
    };
    const opencode = providers.find((provider) => provider.id === "opencode");

    expect(opencode?.models).toEqual(
      expect.arrayContaining(
        [
          "openai/gpt-5.6",
          "openai/gpt-5.6-fast",
          "openai/gpt-5.6-luna",
          "openai/gpt-5.6-luna-fast",
          "openai/gpt-5.6-luna-pro",
          "openai/gpt-5.6-pro",
          "openai/gpt-5.6-sol",
          "openai/gpt-5.6-sol-fast",
          "openai/gpt-5.6-sol-pro",
          "openai/gpt-5.6-terra",
          "openai/gpt-5.6-terra-fast",
          "openai/gpt-5.6-terra-pro",
        ].map((model) => expect.objectContaining({ model, builtIn: true })),
      ),
    );
  });

  test("seeds GPT 5.6 PI models as built-ins with thinking levels", async () => {
    const response = await app.request("/api/runtime-configuration");
    const { providers } = (await response.json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    const pi = providers.find((provider) => provider.id === "pi");

    expect(pi?.models.map((model) => model.model)).toEqual([
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.6-luna",
      "openai-codex/gpt-5.6-sol",
      "openai-codex/gpt-5.6-terra",
      "kimi-coding/k3",
      "deepseek-v4-flash",
    ]);
    expect(pi?.models.every((model) => model.builtIn)).toBe(true);
    expect(
      pi?.models.map((model) => ({
        model: model.model,
        description: model.description,
        thinkingLevels: model.thinkingLevels,
      })),
    ).toEqual([
      {
        model: "openai-codex/gpt-5.5",
        description: "GPT 5.5",
        thinkingLevels: ["low", "medium", "high", "extra-high", "max"],
      },
      {
        model: "openai-codex/gpt-5.6-luna",
        description: "GPT 5.6 Luna",
        thinkingLevels: ["low", "medium", "high", "extra-high", "max"],
      },
      {
        model: "openai-codex/gpt-5.6-sol",
        description: "GPT 5.6 Sol",
        thinkingLevels: ["low", "medium", "high", "extra-high", "max"],
      },
      {
        model: "openai-codex/gpt-5.6-terra",
        description: "GPT 5.6 Terra",
        thinkingLevels: ["low", "medium", "high", "extra-high", "max"],
      },
      {
        model: "kimi-coding/k3",
        description: "Kimi K3 Max",
        thinkingLevels: ["max"],
      },
      {
        model: "deepseek-v4-flash",
        description: "DeepSeek V4 Flash",
        thinkingLevels: ["high", "max"],
      },
    ]);
  });

  test("promotes previously custom catalog models to built-in on reseed", async () => {
    await db
      .insertInto("runtime_configuration_providers")
      .values({
        id: "pi",
        name: "PI",
        command: "pi",
        driver: "pi",
        built_in: true,
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await db
      .insertInto("runtime_configuration_models")
      .values({
        id: "rtmodel_custom_pi_sol",
        provider_id: "pi",
        description: "Sol custom",
        model: "openai-codex/gpt-5.6-sol",
        thinking_levels: JSON.stringify([]),
        fast_mode: false,
        built_in: false,
        position: 9,
        is_default: true,
      })
      .execute();

    const response = await app.request("/api/runtime-configuration");
    const { providers } = (await response.json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    const pi = providers.find((provider) => provider.id === "pi");
    const sol = pi?.models.find((model) => model.model === "openai-codex/gpt-5.6-sol");

    expect(sol).toEqual(
      expect.objectContaining({
        description: "GPT 5.6 Sol",
        builtIn: true,
        thinkingLevels: ["low", "medium", "high", "extra-high", "max"],
        position: 2,
        isDefault: true,
      }),
    );
  });

  test("keeps built-in runtime configuration aligned with the shared runtime catalog", async () => {
    const response = await app.request("/api/runtime-configuration");
    const { providers } = (await response.json()) as {
      providers: RuntimeConfigurationProvider[];
    };

    for (const provider of providers.filter(isBuiltInRuntimeProvider)) {
      expect(provider.models.map((model) => model.model)).toEqual([
        ...getWorkflowModelOptions(provider.driver),
      ]);
      for (const model of provider.models) {
        expectBuiltInModelCapabilities(provider, model);
      }
    }
  });

  test("keeps a deleted legacy-backed provider out of refreshed runtime configuration", async () => {
    await db
      .insertInto("runtime_profiles")
      .values({
        id: "rprof_work_claude",
        name: "Work Claude",
        base_provider: "claude-code",
        command: "claude --work",
        model: "claude-fable-5",
        reasoning: "high",
        fast_mode: false,
      })
      .execute();

    const initialResponse = await app.request("/api/runtime-configuration");
    const initial = (await initialResponse.json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    expect(initial.providers).toContainEqual(
      expect.objectContaining({
        id: "legacy_rprof_work_claude",
        name: "Work Claude",
        command: "claude",
        driver: "claude-code",
        builtIn: false,
        models: [
          expect.objectContaining({
            providerId: "legacy_rprof_work_claude",
            model: "claude-fable-5",
          }),
        ],
      }),
    );

    const deleteResponse = await app.request(
      "/api/runtime-configuration/providers/legacy_rprof_work_claude",
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);

    const refreshedResponse = await app.request("/api/runtime-configuration");
    const refreshed = (await refreshedResponse.json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    expect(refreshed.providers.some((provider) => provider.id === "legacy_rprof_work_claude")).toBe(
      false,
    );
    expect(
      await db
        .selectFrom("runtime_profiles")
        .select("id")
        .where("id", "=", "rprof_work_claude")
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  test("seeds Fable 5 and clones Claude Code as an editable custom provider", async () => {
    const listResponse = await app.request("/api/runtime-configuration");
    const { providers } = (await listResponse.json()) as {
      providers: Array<{
        id: string;
        name: string;
        builtIn: boolean;
        models: Array<{ description: string; model: string; builtIn: boolean }>;
      }>;
    };
    const claude = providers.find((provider) => provider.id === "claude-code");

    expect(claude?.models).toContainEqual(
      expect.objectContaining({
        description: "Fable 5",
        model: "claude-fable-5",
        builtIn: true,
      }),
    );

    const cloneResponse = await app.request(
      "/api/runtime-configuration/providers/claude-code/clone",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Work Claude",
          command: "claude",
          driver: "claude-code",
        }),
      },
    );

    expect(cloneResponse.status).toBe(201);
    const { provider } = (await cloneResponse.json()) as {
      provider: {
        id: string;
        name: string;
        builtIn: boolean;
        models: Array<{ description: string; model: string; builtIn: boolean }>;
      };
    };
    expect(provider).toMatchObject({ name: "Work Claude", builtIn: false });
    expect(provider.models).toContainEqual(
      expect.objectContaining({
        description: "Fable 5",
        model: "claude-fable-5",
        builtIn: false,
      }),
    );

    const updateResponse = await app.request(
      `/api/runtime-configuration/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Edited Claude",
          command: "claude-work",
          driver: "claude-code",
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
  });

  test("accepts arbitrary models for a Claude Code command alias", async () => {
    const providerResponse = await app.request("/api/runtime-configuration/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "CC Personal",
        command: "cpe",
        driver: "claude-code",
      }),
    });
    const { provider } = (await providerResponse.json()) as {
      provider: RuntimeConfigurationProvider;
    };

    const modelResponse = await app.request(
      `/api/runtime-configuration/providers/${provider.id}/models`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "GPT 5.6 Sol Fast",
          model: "gpt-5.6-sol-fast",
          thinkingLevels: ["high", "max"],
        }),
      },
    );

    expect(modelResponse.status).toBe(201);
    expect(await modelResponse.json()).toEqual({
      model: expect.objectContaining({ model: "gpt-5.6-sol-fast" }),
    });
  });

  test("reorders providers and exposes has-fast-mode at the runtime level", async () => {
    const listResponse = await app.request("/api/runtime-configuration");
    const { providers } = (await listResponse.json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    const pi = providers.find((provider) => provider.id === "pi");
    expect(pi?.supportsFastMode).toBe(true);
    const codex = providers.find((provider) => provider.id === "codex-cli");
    expect(codex?.supportsFastMode).toBe(true);

    const reversed = [...providers].map((provider) => provider.id).reverse();
    const reorderResponse = await app.request("/api/runtime-configuration/providers/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerIds: reversed }),
    });
    expect(reorderResponse.status).toBe(200);
    const reordered = (await reorderResponse.json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    expect(reordered.providers.map((provider) => provider.id)).toEqual(reversed);

    expect(pi?.id).toBeTruthy();
    const supportsResponse = await app.request(
      `/api/runtime-configuration/providers/${pi?.id}/supports-fast`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supportsFastMode: false }),
      },
    );
    expect(supportsResponse.status).toBe(200);
    const { provider } = (await supportsResponse.json()) as {
      provider: { supportsFastMode: boolean };
    };
    expect(provider.supportsFastMode).toBe(false);
  });

  test("returns not found when adding a model to a missing provider", async () => {
    const response = await app.request(
      "/api/runtime-configuration/providers/rtprov_missing/models",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Missing",
          model: "missing/model",
          thinkingLevels: [],
        }),
      },
    );

    expect(response.status).toBe(404);
  });

  test("returns conflict for duplicate provider names", async () => {
    const input = { name: "Work Claude", command: "claude-work", driver: "claude-code" };
    expect(
      (
        await app.request("/api/runtime-configuration/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request("/api/runtime-configuration/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(409);
  });

  test("returns conflict for duplicate model identifiers within a provider", async () => {
    await app.request("/api/runtime-configuration");
    const response = await app.request("/api/runtime-configuration/providers/opencode/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Duplicate GPT 5.6",
        model: "openai/gpt-5.6",
        thinkingLevels: ["high"],
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Model already exists for this provider",
    });
  });

  test("persists model order and returns it from every configuration read", async () => {
    const initial = (await (await app.request("/api/runtime-configuration")).json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    const codex = initial.providers.find((provider) => provider.id === "codex-cli");
    if (!codex || codex.models.length < 2) throw new Error("Expected Codex models");
    const reversedIds = codex.models.map((model) => model.id).reverse();

    const response = await app.request(
      "/api/runtime-configuration/providers/codex-cli/models/order",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelIds: reversedIds }),
      },
    );

    expect(response.status).toBe(200);
    const { provider } = (await response.json()) as { provider: RuntimeConfigurationProvider };
    expect(provider.models.map((model) => model.id)).toEqual(reversedIds);
    const refreshed = (await (await app.request("/api/runtime-configuration")).json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    expect(
      refreshed.providers
        .find((provider) => provider.id === "codex-cli")
        ?.models.map((model) => model.id),
    ).toEqual(reversedIds);
  });

  test("sets one default model per provider and allows clearing it", async () => {
    const initial = (await (await app.request("/api/runtime-configuration")).json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    const codex = initial.providers.find((provider) => provider.id === "codex-cli");
    const preferred = codex?.models[1];
    if (!preferred) throw new Error("Expected a second Codex model");

    const response = await app.request(
      `/api/runtime-configuration/models/${preferred.id}/default`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      },
    );

    expect(response.status).toBe(200);
    const { provider } = (await response.json()) as { provider: RuntimeConfigurationProvider };
    expect(provider.models.filter((model) => model.isDefault).map((model) => model.id)).toEqual([
      preferred.id,
    ]);

    const clearResponse = await app.request(
      `/api/runtime-configuration/models/${preferred.id}/default`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: false }),
      },
    );
    const cleared = (await clearResponse.json()) as { provider: RuntimeConfigurationProvider };
    expect(cleared.provider.models.some((model) => model.isDefault)).toBe(false);
  });

  test("sets default thinking level for a model", async () => {
    const initial = (await (await app.request("/api/runtime-configuration")).json()) as {
      providers: RuntimeConfigurationProvider[];
    };
    const pi = initial.providers.find((provider) => provider.id === "pi");
    const model = pi?.models[0];
    if (!model) throw new Error("Expected a PI model");
    expect(model.thinkingLevels).toContain("high");

    const response = await app.request(
      `/api/runtime-configuration/models/${model.id}/default-thinking`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultThinkingLevel: "high" }),
      },
    );

    expect(response.status).toBe(200);
    const { provider } = (await response.json()) as { provider: RuntimeConfigurationProvider };
    expect(provider.models.find((item) => item.id === model.id)?.defaultThinkingLevel).toBe("high");

    const invalid = await app.request(
      `/api/runtime-configuration/models/${model.id}/default-thinking`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultThinkingLevel: "not-a-level" }),
      },
    );
    expect(invalid.status).toBe(400);
  });
});

const expectBuiltInModelCapabilities = (
  provider: RuntimeConfigurationProvider,
  model: RuntimeConfigurationProvider["models"][number],
) => {
  if (provider.driver === "custom") throw new Error("Built-in provider cannot use custom driver");
  expect(model.thinkingLevels).toEqual(
    supportsThinkingLevel(provider.driver, model.model)
      ? getWorkflowThinkingOptions(provider.driver, model.model).map((option) => option.value)
      : [],
  );
  expect(provider.supportsFastMode).toBe(runtimeSupportsFastMode(provider.driver));
};

const isBuiltInRuntimeProvider = (
  provider: RuntimeConfigurationProvider,
): provider is RuntimeConfigurationProvider & { driver: WorkflowRuntimeProvider } =>
  provider.builtIn && provider.driver !== "custom";
