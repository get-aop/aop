import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  AuthPrincipalSchema,
  DeviceSchema,
  PairedDeviceSchema,
  PairingCodeSchema,
} from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { routeAccess } from "./route-policy.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "./test-utils.ts";

const JSON_HEADERS = { "content-type": "application/json" };

describe("auth routes", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;

  // The host owner at the machine, and a client that reached the server over the tailnet.
  const local = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:25150${path}`, init, LOOPBACK_PEER);
  const remote = (path: string, init: RequestInit = {}, origin = "https://mac.tail1234.ts.net") =>
    app.request(`${origin}${path}`, init, REMOTE_PEER);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
    method: "POST",
    headers: { ...JSON_HEADERS, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  const issueCode = async (): Promise<string> =>
    ((await (await local("/api/auth/pairing-codes", { method: "POST" })).json()) as AnyJson).code;
  const pair = async (name = "Work Mac", origin?: string) => {
    const res = await remote("/api/auth/pair", post({ code: await issueCode(), name }), origin);
    expect(res.status).toBe(201);
    return PairedDeviceSchema.parse(await res.json());
  };

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp({ ctx: createCommandContext(db), startTimeMs: Date.now() });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("POST /api/auth/pairing-codes", () => {
    test("shows the host owner a one-time code", async () => {
      const res = await local("/api/auth/pairing-codes", { method: "POST" });

      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const grant = PairingCodeSchema.parse(await res.json());
      expect(grant.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(Date.parse(grant.expiresAt)).toBeGreaterThan(Date.now());
    });

    test("is not available to a remote client, paired or not", async () => {
      const { token } = await pair();

      const anonymous = await remote("/api/auth/pairing-codes", { method: "POST" });
      const device = await remote("/api/auth/pairing-codes", {
        method: "POST",
        headers: bearer(token),
      });

      expect(anonymous.status).toBe(401);
      expect(device.status).toBe(403);
    });
  });

  describe("POST /api/auth/pair", () => {
    test("pairs a remote client that presents the code, and hands back its token once", async () => {
      const { device, token } = await pair("Work Mac");

      expect(device.name).toBe("Work Mac");
      expect(token).toMatch(/^aop_/);
      const me = await remote("/api/auth/me", { headers: bearer(token) });
      expect(AuthPrincipalSchema.parse(await me.json())).toEqual({
        kind: "device",
        device: expect.objectContaining({ id: device.id }),
      });
    });

    test("never returns the token again", async () => {
      const { device, token } = await pair();

      const list = JSON.stringify(await (await local("/api/auth/devices")).json());
      const me = JSON.stringify(
        await (await remote("/api/auth/me", { headers: bearer(token) })).json(),
      );

      expect(list).toContain(device.id);
      expect(list).not.toContain(token);
      expect(me).not.toContain(token);
    });

    test("sets a session cookie the browser keeps out of scripts and other sites", async () => {
      const res = await remote(
        "/api/auth/pair",
        post({ code: await issueCode(), name: "Browser" }),
      );
      const { token } = PairedDeviceSchema.parse(await res.json());

      const cookie = res.headers.get("set-cookie") ?? "";

      expect(cookie).toContain(`aop_device=${token}`);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).toContain("Path=/");
      expect(cookie).toMatch(/Max-Age=\d+/);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    test("marks the cookie Secure over https and not over plain http", async () => {
      const overHttps = await remote(
        "/api/auth/pair",
        post({ code: await issueCode(), name: "A" }),
      );
      const overHttp = await remote(
        "/api/auth/pair",
        post({ code: await issueCode(), name: "B" }),
        "http://192.168.1.20:25150",
      );
      const behindProxy = await remote(
        "/api/auth/pair",
        post({ code: await issueCode(), name: "C" }, { "x-forwarded-proto": "https" }),
        "http://192.168.1.20:25150",
      );

      expect(overHttps.headers.get("set-cookie")).toContain("Secure");
      expect(overHttp.headers.get("set-cookie")).not.toContain("Secure");
      expect(behindProxy.headers.get("set-cookie")).toContain("Secure");
    });

    test("a code pairs one device", async () => {
      const code = await issueCode();
      const first = await remote("/api/auth/pair", post({ code, name: "Work Mac" }));
      const second = await remote("/api/auth/pair", post({ code, name: "Windows PC" }));

      expect(first.status).toBe(201);
      expect(second.status).toBe(401);
      expect(await second.json()).toEqual({
        error: "Wrong or expired pairing code",
        code: "INVALID_PAIRING_CODE",
      });
      expect(second.headers.get("set-cookie")).toBeNull();
    });

    test("refuses a request without a usable code or name", async () => {
      const code = await issueCode();
      const badBodies = [
        "not json",
        {},
        { code },
        { name: "Work Mac" },
        { code: " ", name: "Work Mac" },
        { code, name: "  " },
        { code, name: "n".repeat(101) },
      ];

      for (const body of badBodies) {
        const res = await remote("/api/auth/pair", post(body));
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
      // None of those spent the code.
      expect((await remote("/api/auth/pair", post({ code, name: "Work Mac" }))).status).toBe(201);
    });

    test("answers 429 once a guesser has burned the wrong-code budget", async () => {
      const code = await issueCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const wrong = await remote("/api/auth/pair", post({ code: "AAAA-AAAA", name: "Guess" }));
        expect(wrong.status).toBe(401);
      }

      const blocked = await remote("/api/auth/pair", post({ code, name: "Work Mac" }));

      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED" });
    });
  });

  describe("GET /api/auth/me", () => {
    test("tells the host owner apart from a device", async () => {
      const res = await local("/api/auth/me");

      expect(await res.json()).toEqual({ kind: "owner" });
    });

    test("needs credentials from a remote client", async () => {
      expect((await remote("/api/auth/me")).status).toBe(401);
    });
  });

  describe("session cookie", () => {
    test("POST /session swaps a bearer token for the cookie an EventSource can send", async () => {
      const { token } = await pair();
      const exchange = await remote("/api/auth/session", {
        method: "POST",
        headers: bearer(token),
      });
      const cookie = exchange.headers.get("set-cookie") ?? "";
      expect(exchange.status).toBe(200);
      expect(cookie).toContain(`aop_device=${token}`);

      const me = await remote("/api/auth/me", { headers: { cookie: `aop_device=${token}` } });

      expect(me.status).toBe(200);
      expect(((await me.json()) as AnyJson).kind).toBe("device");
    });

    test("refuses to set a cookie for a token the host does not know", async () => {
      const remoteExchange = await remote("/api/auth/session", {
        method: "POST",
        headers: bearer("aop_made-up"),
      });
      // A direct local request is trusted without credentials, but must not mint a cookie from a forged one.
      const localExchange = await local("/api/auth/session", {
        method: "POST",
        headers: bearer("aop_made-up"),
      });
      const noToken = await local("/api/auth/session", { method: "POST" });

      for (const res of [remoteExchange, localExchange, noToken]) {
        expect(res.status).toBe(401);
        expect(res.headers.get("set-cookie")).toBeNull();
      }
    });

    test("DELETE /session signs the device out for good", async () => {
      const { token } = await pair();
      const res = await remote("/api/auth/session", {
        method: "DELETE",
        headers: bearer(token),
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("set-cookie")).toMatch(/aop_device=;.*(Max-Age=0|Expires=)/);
      expect((await remote("/api/auth/me", { headers: bearer(token) })).status).toBe(401);
      expect(((await (await local("/api/auth/devices")).json()) as AnyJson).devices).toEqual([]);
    });

    test("a cross-site page cannot ride the cookie", async () => {
      const { token } = await pair();

      const res = await remote("/api/auth/session", {
        method: "DELETE",
        headers: { cookie: `aop_device=${token}`, origin: "https://evil.example" },
      });

      expect(res.status).toBe(403);
      expect((await remote("/api/auth/me", { headers: bearer(token) })).status).toBe(200);
    });
  });

  describe("devices", () => {
    test("GET /devices lists what the host owner has paired", async () => {
      await pair("Work Mac");
      await pair("Windows PC");

      const res = await local("/api/auth/devices");
      const { devices } = (await res.json()) as AnyJson;

      expect(devices.map((device: { name: string }) => device.name).sort()).toEqual([
        "Windows PC",
        "Work Mac",
      ]);
      for (const device of devices) expect(DeviceSchema.safeParse(device).success).toBe(true);
      for (const device of devices)
        expect(Object.keys(device).sort()).toEqual(["createdAt", "id", "lastSeenAt", "name"]);
    });

    test("DELETE /devices/:id revokes it: the next request with its token fails", async () => {
      const { device, token } = await pair();
      expect((await remote("/api/auth/me", { headers: bearer(token) })).status).toBe(200);

      const revoke = await local(`/api/auth/devices/${device.id}`, { method: "DELETE" });

      expect(revoke.status).toBe(204);
      expect((await remote("/api/auth/me", { headers: bearer(token) })).status).toBe(401);
      expect((await remote("/api/status", { headers: bearer(token) })).status).toBe(401);
      expect(((await (await local("/api/auth/devices")).json()) as AnyJson).devices).toEqual([]);
    });

    test("revoking an unknown device is a 404", async () => {
      const res = await local("/api/auth/devices/no-such-device", { method: "DELETE" });

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
    });

    test("a paired device cannot list devices or revoke one, itself included", async () => {
      const { device, token } = await pair();

      const list = await remote("/api/auth/devices", { headers: bearer(token) });
      const revoke = await remote(`/api/auth/devices/${device.id}`, {
        method: "DELETE",
        headers: bearer(token),
      });

      expect(list.status).toBe(403);
      expect(revoke.status).toBe(403);
      expect((await remote("/api/auth/me", { headers: bearer(token) })).status).toBe(200);
    });
  });

  describe("every API route", () => {
    // Routes are enumerated from the mounted app, so a route added later is covered without
    // anyone remembering to list it here.
    const PUBLIC = new Set([
      "GET /api/health",
      "POST /api/auth/pair",
      "POST /api/mcp",
      "GET /api/mcp",
      "GET /api/mcp/tools",
    ]);
    const concrete = (path: string) => path.replace(/:[^/]+/g, "x");

    test("turns away a remote client with no credentials, except the public ones", async () => {
      const routes = app.routes.filter(
        (route) => route.path.startsWith("/api/") && route.method !== "ALL",
      );
      expect(routes.length).toBeGreaterThan(30);

      const unguarded: string[] = [];
      for (const { method, path } of routes) {
        const key = `${method} ${path.replace(/\/$/, "")}`;
        const res = await remote(concrete(path), { method });
        const body = (await res.json().catch(() => ({}))) as AnyJson;
        const rejectedByGuard = res.status === 401 && body.code === "UNAUTHENTICATED";
        if (PUBLIC.has(key) === rejectedByGuard) unguarded.push(`${key} -> ${res.status}`);
      }

      expect(unguarded).toEqual([]);
    });

    test("keeps the host-only routes the policy names mounted", () => {
      const mounted = new Set(app.routes.map((route) => `${route.method} ${route.path}`));
      const hostOnly = [
        "POST /api/auth/pairing-codes",
        "GET /api/auth/devices",
        "DELETE /api/auth/devices/:id",
        "POST /api/updates/apply",
        "POST /api/agent-clis/:provider/update",
        "PUT /api/projects/:projectId/computer-use",
        "POST /api/mcp-secret/rotate",
        "POST /api/projects/:projectId/routines",
        "PATCH /api/projects/:projectId/routines/:routineId",
        "DELETE /api/projects/:projectId/routines/:routineId",
        "POST /api/projects/:projectId/routines/:routineId/run",
        "PUT /api/projects/:projectId/linear",
        "DELETE /api/projects/:projectId/linear",
        "POST /api/projects/:projectId/linear/catalog",
        "PUT /api/projects/:projectId/jira",
        "DELETE /api/projects/:projectId/jira",
        "POST /api/projects/:projectId/jira/test",
      ];

      for (const route of hostOnly) {
        const [method = "", path = ""] = route.split(" ");
        expect({ route, mounted: mounted.has(route) }).toEqual({ route, mounted: true });
        expect(routeAccess(method, concrete(path))).toBe("owner");
      }
    });

    test("leaves reading routines to any device, and the routine caps to the owner", () => {
      expect(routeAccess("GET", "/api/projects/x/routines")).toBe("device");
      expect(routeAccess("GET", "/api/projects/x/routines/x/runs")).toBe("device");
      expect(routeAccess("POST", "/api/projects/x/routines/preview")).toBe("device");
      expect(routeAccess("PUT", "/api/settings/routine_min_interval_minutes")).toBe("owner");
      expect(routeAccess("PUT", "/api/settings/routine_max_active_per_project")).toBe("owner");
    });
  });
});
