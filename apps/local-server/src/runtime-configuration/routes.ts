import {
  DefaultRuntimeInputSchema,
  describeFirstIssue,
  type RuntimeConfigurationModelInput,
  RuntimeConfigurationModelInputSchema,
  type RuntimeConfigurationProviderInput,
  RuntimeConfigurationProviderInputSchema,
  RuntimeThinkingLevelSchema,
  type RuntimeUsage,
} from "@aop/common";
import { Hono } from "hono";
import { z } from "zod";
import type { LocalServerContext } from "../context.ts";
import { createRuntimeConfigurationRepository } from "./repository.ts";
import type { RuntimeConfigurationService } from "./service.ts";

export const createRuntimeConfigurationRoutes = (
  ctx: LocalServerContext,
  service: RuntimeConfigurationService,
) => {
  const app = new Hono();
  const repository = createRuntimeConfigurationRepository(ctx.db);

  app.get("/", async (c) => c.json(await service.list()));
  // `?fresh=1` looks at every command again instead of using looks from the last minute.
  app.get("/status", async (c) =>
    c.json({ statuses: await service.statuses({ fresh: c.req.query("fresh") === "1" }) }),
  );
  app.put("/default", async (c) => {
    const input = DefaultRuntimeInputSchema.safeParse(await readBody(c));
    if (!input.success) return c.json({ error: "Invalid runtime" }, 400);
    const result = await service.setDefault(input.data.runtimeId);
    return result.success
      ? c.json({ defaultRuntimeId: result.defaultRuntimeId })
      : c.json({ error: "Runtime not found", code: result.error.code }, 404);
  });
  app.post("/providers", async (c) => {
    const input = RuntimeConfigurationProviderInputSchema.safeParse(await readBody(c));
    if (!input.success)
      return c.json({ error: describeFirstIssue(input.error.issues, "Invalid provider") }, 400);
    try {
      return c.json({ provider: await repository.createProvider(input.data) }, 201);
    } catch (error) {
      if (isDuplicateProviderNameError(error)) {
        return c.json({ error: "Provider name already exists" }, 409);
      }
      throw error;
    }
  });
  app.patch("/providers/:id", async (c) => {
    const input = RuntimeConfigurationProviderInputSchema.safeParse(await readBody(c));
    if (!input.success)
      return c.json({ error: describeFirstIssue(input.error.issues, "Invalid provider") }, 400);
    return patchProvider(c, repository, c.req.param("id"), input.data);
  });
  app.post("/providers/:id/clone", async (c) => {
    const input = RuntimeConfigurationProviderInputSchema.safeParse(await readBody(c));
    if (!input.success)
      return c.json({ error: describeFirstIssue(input.error.issues, "Invalid provider") }, 400);
    try {
      const provider = await repository.cloneProvider(c.req.param("id"), input.data);
      return provider ? c.json({ provider }, 201) : c.json({ error: "Provider not found" }, 404);
    } catch (error) {
      if (isDuplicateProviderNameError(error)) {
        return c.json({ error: "Provider name already exists" }, 409);
      }
      throw error;
    }
  });
  app.get("/providers/:id/usage", async (c) =>
    c.json({ usage: await service.usage(c.req.param("id")) }),
  );
  // `?moveTo=default` moves the projects and threads using it to the host's default first.
  app.delete("/providers/:id", async (c) => {
    const result = await service.remove(c.req.param("id"), {
      moveToDefault: c.req.query("moveTo") === "default",
    });
    if (result.success) return c.body(null, 204);
    if (result.error.code === "RUNTIME_IN_USE") {
      return c.json(
        {
          error: describeUsage(result.error.usage),
          code: result.error.code,
          usage: result.error.usage,
        },
        409,
      );
    }
    return c.json({ error: "Provider not found or locked", code: result.error.code }, 404);
  });
  app.post("/providers/:id/models", async (c) => {
    const input = RuntimeConfigurationModelInputSchema.safeParse(await readBody(c));
    if (!input.success)
      return c.json({ error: describeFirstIssue(input.error.issues, "Invalid model") }, 400);
    return createProviderModel(c, repository, c.req.param("id"), input.data);
  });
  app.patch("/models/:id", async (c) => {
    const input = RuntimeConfigurationModelInputSchema.safeParse(await readBody(c));
    if (!input.success)
      return c.json({ error: describeFirstIssue(input.error.issues, "Invalid model") }, 400);
    return updateProviderModel(c, repository, c.req.param("id"), input.data);
  });
  app.delete("/models/:id", async (c) =>
    (await repository.deleteModel(c.req.param("id")))
      ? c.body(null, 204)
      : c.json({ error: "Model not found or locked" }, 404),
  );
  app.put("/providers/:id/models/order", async (c) => {
    const input = z.object({ modelIds: z.array(z.string()).min(1) }).safeParse(await readBody(c));
    if (!input.success) return c.json({ error: "Invalid model order" }, 400);
    const provider = await repository.reorderModels(c.req.param("id"), input.data.modelIds);
    return provider ? c.json({ provider }) : c.json({ error: "Invalid model order" }, 400);
  });
  app.put("/providers/order", async (c) => {
    const input = z
      .object({ providerIds: z.array(z.string()).min(1) })
      .safeParse(await readBody(c));
    if (!input.success) return c.json({ error: "Invalid provider order" }, 400);
    const providers = await repository.reorderProviders(input.data.providerIds);
    return providers ? c.json({ providers }) : c.json({ error: "Invalid provider order" }, 400);
  });
  app.patch("/models/:id/default", async (c) => {
    const input = z.object({ isDefault: z.boolean() }).safeParse(await readBody(c));
    if (!input.success) return c.json({ error: "Invalid default model value" }, 400);
    const provider = await repository.setDefaultModel(c.req.param("id"), input.data.isDefault);
    return provider ? c.json({ provider }) : c.json({ error: "Model not found" }, 404);
  });
  app.patch("/models/:id/default-thinking", async (c) => {
    const input = z
      .object({ defaultThinkingLevel: RuntimeThinkingLevelSchema.nullable() })
      .safeParse(await readBody(c));
    if (!input.success) return c.json({ error: "Invalid default thinking level" }, 400);
    const provider = await repository.setDefaultThinkingLevel(
      c.req.param("id"),
      input.data.defaultThinkingLevel,
    );
    return provider
      ? c.json({ provider })
      : c.json({ error: "Model not found or thinking level unavailable" }, 404);
  });
  app.patch("/providers/:id/supports-fast", async (c) => {
    const input = z.object({ supportsFastMode: z.boolean() }).safeParse(await readBody(c));
    if (!input.success) return c.json({ error: "Invalid supports-fast value" }, 400);
    const provider = await repository.setProviderSupportsFastMode(
      c.req.param("id"),
      input.data.supportsFastMode,
    );
    return provider ? c.json({ provider }) : c.json({ error: "Provider not found" }, 404);
  });
  return app;
};

const describeUsage = (usage: readonly RuntimeUsage[]): string =>
  `Projects use this runtime: ${usage.map((entry) => entry.projectName).join(", ")}. ` +
  "Move them to another runtime first, or move them to the default runtime and remove it.";

const readBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> =>
  c.req.json().catch(() => null);

type RuntimeConfigurationRepositoryType = ReturnType<typeof createRuntimeConfigurationRepository>;

const patchProvider = async (
  c: { json: (body: unknown, status?: number) => Response },
  repository: RuntimeConfigurationRepositoryType,
  providerId: string,
  input: RuntimeConfigurationProviderInput,
) => {
  try {
    const provider = await repository.updateProvider(providerId, input);
    return provider ? c.json({ provider }) : c.json({ error: "Provider not found or locked" }, 404);
  } catch (error) {
    if (isDuplicateProviderNameError(error)) {
      return c.json({ error: "Provider name already exists" }, 409);
    }
    throw error;
  }
};

const updateProviderModel = async (
  c: { json: (body: unknown, status?: number) => Response },
  repository: RuntimeConfigurationRepositoryType,
  modelId: string,
  input: RuntimeConfigurationModelInput,
) => {
  try {
    const model = await repository.updateModel(modelId, input);
    return model ? c.json({ model }) : c.json({ error: "Model not found or locked" }, 404);
  } catch (error) {
    if (isDuplicateModelError(error)) {
      return c.json({ error: "Model already exists for this provider" }, 409);
    }
    throw error;
  }
};

const createProviderModel = async (
  c: { json: (body: unknown, status?: number) => Response },
  repository: RuntimeConfigurationRepositoryType,
  providerId: string,
  input: RuntimeConfigurationModelInput,
) => {
  try {
    const model = await repository.createModel(providerId, input);
    return model ? c.json({ model }, 201) : c.json({ error: "Provider not found" }, 404);
  } catch (error) {
    if (isDuplicateModelError(error)) {
      return c.json({ error: "Model already exists for this provider" }, 409);
    }
    throw error;
  }
};

const isDuplicateProviderNameError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.includes("idx_runtime_configuration_provider_name_nocase") ||
    error.message.includes("UNIQUE constraint failed: runtime_configuration_providers.name"));

const isDuplicateModelError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.includes("idx_runtime_configuration_model_provider_name") ||
    error.message.includes(
      "UNIQUE constraint failed: runtime_configuration_models.provider_id, runtime_configuration_models.model",
    ));
