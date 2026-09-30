import { PairDeviceRequestSchema } from "@aop/common";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import type { AuthEnv } from "./api-auth.ts";
import { bearerTokenOf, clearSessionCookie, setSessionCookie } from "./credentials.ts";

/** Who may call each route is decided in `route-policy.ts`, not here. */
export const createAuthRoutes = (ctx: LocalServerContext) => {
  const auth = ctx.authService;
  const routes = new Hono<AuthEnv>();

  // Responses carry tokens and device lists: never let a shared cache keep them.
  routes.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  routes.get("/me", (c) => c.json(c.get("principal")));

  routes.post("/pairing-codes", (c) => {
    const grant = auth.issuePairingCode();
    return c.json({ code: grant.code, expiresAt: grant.expiresAt.toISOString() }, 201);
  });

  routes.post("/pair", async (c) => {
    const parsed = PairDeviceRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid pairing request" }, 400);
    }

    const result = await auth.pairDevice(parsed.data);
    if (result.status === "rate-limited") {
      return c.json(
        { error: "Too many wrong pairing codes. Try again shortly.", code: "RATE_LIMITED" },
        429,
        { "Retry-After": String(result.retryAfterSeconds) },
      );
    }
    if (result.status === "invalid-code") {
      return c.json({ error: "Wrong or expired pairing code", code: "INVALID_PAIRING_CODE" }, 401);
    }

    setSessionCookie(c, result.token);
    return c.json({ device: result.device, token: result.token }, 201);
  });

  // Trades a bearer token for the cookie an EventSource can send. The token is checked here
  // rather than trusted from the middleware, which lets a direct local request through
  // without looking at any credential.
  routes.post("/session", async (c) => {
    const token = bearerTokenOf(c);
    const device = token ? await auth.authenticate(token) : null;
    if (!token || !device) {
      return c.json({ error: "A valid device token is required", code: "UNAUTHENTICATED" }, 401);
    }
    setSessionCookie(c, token);
    return c.json({ kind: "device", device });
  });

  // Signing out unpairs: the browser keeps its token only in the cookie, so a device that
  // merely dropped it would sit in the owner's list, unreachable and unrevoked.
  routes.delete("/session", async (c) => {
    const principal = c.get("principal");
    if (principal.kind === "device") await auth.revokeDevice(principal.device.id);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  routes.get("/devices", async (c) => c.json({ devices: await auth.listDevices() }));

  routes.delete("/devices/:id", async (c) => {
    const removed = await auth.revokeDevice(c.req.param("id"));
    if (!removed) return c.json({ error: "Device not found", code: "NOT_FOUND" }, 404);
    return c.body(null, 204);
  });

  return routes;
};
