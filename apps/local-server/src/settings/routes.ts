import { type Context, Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import {
  getAllSettings,
  getSetting,
  type SetSettingResult,
  type SettingsEffects,
  setAllSettings,
  setSetting,
} from "./handlers.ts";

export const createSettingsRoutes = (ctx: LocalServerContext, effects: SettingsEffects = {}) => {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const result = await getAllSettings(ctx);
    return c.json({ settings: result.settings });
  });

  routes.put("/", async (c) => {
    const body = await c.req.json<{ settings: Array<{ key: string; value: string }> }>();

    if (!Array.isArray(body.settings)) {
      return c.json({ error: "Missing required field: settings" }, 400);
    }

    const result = await setAllSettings(ctx, body.settings, effects);
    if (!result.success) return rejected(c, result.error);

    return c.json({ ok: true, settings: result.settings });
  });

  routes.get("/:key", async (c) => {
    const key = c.req.param("key");

    const result = await getSetting(ctx, key);
    if (!result.success) {
      return c.json({ error: "Invalid key", key, validKeys: result.error.validKeys }, 400);
    }

    return c.json({ key: result.key, value: result.value });
  });

  routes.put("/:key", async (c) => {
    const key = c.req.param("key");
    const body = await c.req.json<{ value: string }>();

    if (body.value === undefined) {
      return c.json({ error: "Missing required field: value" }, 400);
    }

    const result = await setSetting(ctx, key, body.value, effects);
    if (!result.success) return rejected(c, result.error);

    return c.json({ ok: true, key: result.key, value: result.value });
  });

  return routes;
};

type SettingError = Extract<SetSettingResult, { success: false }>["error"];

const rejected = (c: Context, error: SettingError) =>
  error.code === "INVALID_KEY"
    ? c.json({ error: "Invalid key", key: error.key, validKeys: error.validKeys }, 400)
    : c.json({ error: "Invalid value", key: error.key, message: error.message }, 400);
