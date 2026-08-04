import { ExecHostUpsertSchema } from "@aop/common";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { LocalServerContext } from "../context.ts";
import { createExecHostsService, ensureHostIds } from "./service.ts";

const ExecHostsPutSchema = z.array(ExecHostUpsertSchema);

export const createExecHostRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();
  const service = createExecHostsService(ctx);

  routes.get("/", async (c) => c.json({ hosts: await service.listExecHosts() }));

  routes.put("/", async (c) => {
    const body = await readBody(c);
    const parsed = ExecHostsPutSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid execution hosts",
          code: "INVALID_EXEC_HOSTS",
        },
        400,
      );
    }

    try {
      const hosts = ensureHostIds(parsed.data);
      const saved = await service.saveExecHosts(hosts);
      return c.json({ hosts: saved });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : "Failed to save hosts",
          code: "INVALID_EXEC_HOSTS",
        },
        400,
      );
    }
  });

  routes.post("/:id/test", async (c) => {
    const result = await service.testExecHost(c.req.param("id"));
    if (result.error?.startsWith("Execution host not found")) {
      return c.json({ error: result.error }, 404);
    }
    return c.json(result);
  });

  return routes;
};

const readBody = async (c: Context): Promise<unknown> => c.req.json().catch(() => null);
