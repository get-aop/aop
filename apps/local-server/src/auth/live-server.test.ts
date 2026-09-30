import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";

// Everything else in this slice stands in for the socket with a fake `env`. This runs the
// app behind a real `Bun.serve`, the way `server.ts` does, so the wiring the guard depends on
// (Bun handing the server to Hono, `requestIP` naming the peer) is exercised for real.
describe("auth behind a real listener", () => {
  let db: Kysely<Database>;
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  const call = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, init);
  const asProxy = { "x-forwarded-for": "100.64.0.7", "x-forwarded-proto": "https" };

  beforeAll(async () => {
    db = await createTestDb();
    const app = createApp({ ctx: createCommandContext(db), startTimeMs: Date.now() });
    server = Bun.serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.stop(true);
    await db.destroy();
  });

  test("a request made directly on the host is the owner's", async () => {
    const res = await call("/api/auth/me");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "owner" });
  });

  test("the same request through a proxy needs a device token, though the socket is loopback", async () => {
    const res = await call("/api/status", { headers: asProxy });

    expect(res.status).toBe(401);
  });

  test("a client that names another host needs a device token", async () => {
    const res = await call("/api/status", { headers: { host: "mac.tail1234.ts.net" } });

    expect(res.status).toBe(401);
  });

  test("pairs a device through the proxy, then serves it by token and by cookie until revoked", async () => {
    const { code } = (await (
      await call("/api/auth/pairing-codes", { method: "POST" })
    ).json()) as AnyJson;
    const paired = await call("/api/auth/pair", {
      method: "POST",
      headers: { ...asProxy, "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Work Mac" }),
    });
    expect(paired.status).toBe(201);
    const { device, token } = (await paired.json()) as AnyJson;
    const cookie = `aop_device=${token}`;

    const byToken = await call("/api/status", {
      headers: { ...asProxy, authorization: `Bearer ${token}` },
    });
    const byCookie = await call("/api/status", { headers: { ...asProxy, cookie } });
    expect(byToken.status).toBe(200);
    expect(byCookie.status).toBe(200);

    const revoked = await call(`/api/auth/devices/${device.id}`, { method: "DELETE" });
    expect(revoked.status).toBe(204);

    const afterToken = await call("/api/status", {
      headers: { ...asProxy, authorization: `Bearer ${token}` },
    });
    const afterCookie = await call("/api/status", { headers: { ...asProxy, cookie } });
    expect(afterToken.status).toBe(401);
    expect(afterCookie.status).toBe(401);
  });
});
