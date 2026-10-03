import { type Context, Hono } from "hono";
import type { AuthEnv } from "../auth/api-auth.ts";
import {
  type HostCaller,
  readHostManagement,
  settingsWriteRefusal,
} from "../auth/host-management.ts";
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
  const routes = new Hono<AuthEnv>();
  const hostManagement = () => readHostManagement(ctx.settingsRepository);

  routes.get("/", async (c) => {
    const result = await getAllSettings(ctx);
    return c.json({ settings: result.settings });
  });

  routes.put("/", async (c) => {
    const body = await c.req.json<{ settings: Array<{ key: string; value: string }> }>();

    if (!Array.isArray(body.settings)) {
      return c.json({ error: "Missing required field: settings" }, 400);
    }
    // A bulk write carries its keys in the body, where auth/route-policy.ts cannot see them.
    const refusal = await settingsWriteRefusal(
      body.settings.map((entry) => entry.key),
      callerOf(c),
      hostManagement,
    );
    if (refusal) return c.json(refusal, 403);

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
    // auth/route-policy.ts already guards this path; checked again on the decoded key, so no
    // spelling of the path steps around it.
    const refusal = await settingsWriteRefusal([key], callerOf(c), hostManagement);
    if (refusal) return c.json(refusal, 403);

    const result = await setSetting(ctx, key, body.value, effects);
    if (!result.success) return rejected(c, result.error);

    return c.json({ ok: true, key: result.key, value: result.value });
  });

  return routes;
};

// Routes mounted without the auth guard (none in the app) are treated as a plain device.
const callerOf = (c: Context<AuthEnv>): HostCaller =>
  c.get("caller") ?? { kind: "device", agent: false };

type SettingError = Extract<SetSettingResult, { success: false }>["error"];

const rejected = (c: Context, error: SettingError) =>
  error.code === "INVALID_KEY"
    ? c.json({ error: "Invalid key", key: error.key, validKeys: error.validKeys }, 400)
    : c.json({ error: "Invalid value", key: error.key, message: error.message }, 400);
