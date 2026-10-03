import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AGENT_SESSION_HEADER, type HostManagement } from "@aop/common";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { type AuthEnv, createApiAuth } from "./api-auth.ts";
import { createDeviceRepository } from "./device-repository.ts";
import { type AuthService, createAuthService } from "./service.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "./test-utils.ts";

const BASE = "http://mac.tail1234.ts.net";

describe("createApiAuth", () => {
  let db: Kysely<Database>;
  let auth: AuthService;
  let app: Hono<AuthEnv>;
  let management: HostManagement;
  let reached: string[];

  const pair = async (name = "Work Mac") => {
    const result = await auth.pairDevice({ code: auth.issuePairingCode().code, name });
    if (result.status !== "paired") throw new Error(`Expected pairing, got ${result.status}`);
    return result;
  };
  const get = (path: string, headers: Record<string, string> = {}, peer = REMOTE_PEER) =>
    app.request(`${BASE}${path}`, { headers }, peer);

  beforeEach(async () => {
    db = await createTestDb();
    auth = createAuthService({ deviceRepository: createDeviceRepository(db) });
    reached = [];
    app = new Hono<AuthEnv>();
    management = "devices";
    app.use(
      "/api/*",
      createApiAuth(auth, async () => management),
    );
    app.get("/api/stream", (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: "hello", data: "connected" });
        await new Promise(() => {});
      }),
    );
    app.all("/api/*", (c) => {
      reached.push(`${c.req.method} ${c.req.path}`);
      return c.json({ principal: c.get("principal") ?? null });
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("who gets in", () => {
    test("rejects a remote request with no credentials before it reaches the route", async () => {
      const res = await get("/api/data");

      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await res.json()).toEqual({
        error: "Authentication required",
        code: "UNAUTHENTICATED",
      });
      expect(reached).toEqual([]);
    });

    test("lets the host owner's direct request through without credentials", async () => {
      const res = await app.request("http://127.0.0.1:25150/api/data", {}, LOOPBACK_PEER);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ principal: { kind: "owner" } });
    });

    test("does not let a proxy on the host vouch for a remote client", async () => {
      // tailscale serve and Caddy connect from 127.0.0.1 and forward the client's request.
      const viaProxy = { "x-forwarded-for": "100.64.0.7", "x-forwarded-proto": "https" };

      const res = await app.request(`${BASE}/api/data`, { headers: viaProxy }, LOOPBACK_PEER);

      expect(res.status).toBe(401);
      expect(reached).toEqual([]);
    });

    test("does not let a proxy that keeps a loopback Host vouch for a remote client", async () => {
      const res = await app.request(
        "http://127.0.0.1:25150/api/data",
        { headers: { "x-forwarded-for": "100.64.0.7" } },
        LOOPBACK_PEER,
      );

      expect(res.status).toBe(401);
    });

    test("accepts a device's bearer token", async () => {
      const { device, token } = await pair();

      const res = await get("/api/data", { authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { principal: { kind: string; device: { id: string } } };
      expect(body.principal.kind).toBe("device");
      expect(body.principal.device.id).toBe(device.id);
    });

    test("accepts a device's session cookie, which is how an EventSource authenticates", async () => {
      const { token } = await pair();

      const res = await get("/api/data", { cookie: `aop_device=${token}` });

      expect(res.status).toBe(200);
    });

    test("rejects an unknown token and a malformed Authorization header", async () => {
      await pair();

      for (const authorization of ["Bearer aop_wrong", "Bearer", "Basic dXNlcjpwYXNz", "aop_x"]) {
        expect((await get("/api/data", { authorization })).status).toBe(401);
      }
      expect((await get("/api/data", { cookie: "aop_device=aop_wrong" })).status).toBe(401);
    });

    test("a stale cookie on the host's own dashboard does not lock the owner out", async () => {
      const res = await app.request(
        "http://127.0.0.1:25150/api/data",
        { headers: { cookie: "aop_device=aop_revoked" } },
        LOOPBACK_PEER,
      );

      expect(res.status).toBe(200);
    });
  });

  describe("revocation", () => {
    test("the revoked device's next request fails", async () => {
      const { device, token } = await pair();
      const authorization = `Bearer ${token}`;
      expect((await get("/api/data", { authorization })).status).toBe(200);

      await auth.revokeDevice(device.id);

      expect((await get("/api/data", { authorization })).status).toBe(401);
      expect((await get("/api/data", { cookie: `aop_device=${token}` })).status).toBe(401);
    });

    test("closes the event stream a revoked device already holds open", async () => {
      const { device, token } = await pair();
      const res = await get("/api/stream", { cookie: `aop_device=${token}` });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain("event: hello");

      await auth.revokeDevice(device.id);

      const next = await Promise.race([
        reader.read(),
        Bun.sleep(2_000).then(() => "still open" as const),
      ]);
      expect(next).not.toBe("still open");
      expect(next).toMatchObject({ done: true });
    });

    test("leaves another device's stream open", async () => {
      const revoked = await pair("Windows PC");
      const kept = await pair("Work Mac");
      const res = await get("/api/stream", { cookie: `aop_device=${kept.token}` });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();

      await auth.revokeDevice(revoked.device.id);

      const next = await Promise.race([reader.read(), Bun.sleep(200).then(() => "still open")]);
      expect(next).toBe("still open");
      await reader.cancel();
    });

    test("a stream that ends on its own stops listening for revocation", async () => {
      const { device, token } = await pair();
      const res = await get("/api/stream", { cookie: `aop_device=${token}` });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();

      await reader.cancel();

      // Nothing to observe except that revoking afterwards does not throw.
      expect(await auth.revokeDevice(device.id)).toBe(true);
    });
  });

  describe("route policy", () => {
    test("public routes need no credentials", async () => {
      for (const [method, path] of [
        ["GET", "/api/health"],
        ["POST", "/api/auth/pair"],
        ["POST", "/api/mcp"],
        ["GET", "/api/mcp/tools"],
      ] as const) {
        const res = await app.request(`${BASE}${path}`, { method }, REMOTE_PEER);
        expect({ path, status: res.status }).toEqual({ path, status: 200 });
      }
    });

    test("only the health probe is public under /api/health, and only for GET", async () => {
      expect((await get("/api/health/details")).status).toBe(401);
      const post = await app.request(`${BASE}/api/health`, { method: "POST" }, REMOTE_PEER);
      expect(post.status).toBe(401);
    });

    test("host-only routes refuse a paired device and admit the owner", async () => {
      const { token } = await pair();
      const authorization = `Bearer ${token}`;
      const hostOnly = [
        ["PUT", "/api/settings/host_management"],
        ["PUT", "/api/settings/agent_cli_skip_permissions"],
        ["POST", "/api/mcp-secret/rotate"],
      ] as const;

      for (const [method, path] of hostOnly) {
        const asDevice = await app.request(
          `${BASE}${path}`,
          { method, headers: { authorization } },
          REMOTE_PEER,
        );
        expect({ path, status: asDevice.status }).toEqual({ path, status: 403 });
        expect(await asDevice.json()).toEqual({
          error: "Only available on the host machine",
          code: "HOST_ONLY",
        });

        const asOwner = await app.request(
          `http://127.0.0.1:25150${path}`,
          { method },
          LOOPBACK_PEER,
        );
        expect({ path, status: asOwner.status }).toEqual({ path, status: 200 });
      }
    });

    test("manager routes follow host_management: devices by default, the owner only when narrowed", async () => {
      const { token } = await pair();
      const asDevice = () =>
        app.request(
          `${BASE}/api/auth/pairing-codes`,
          { method: "POST", headers: { authorization: `Bearer ${token}` } },
          REMOTE_PEER,
        );

      expect((await asDevice()).status).toBe(200);
      management = "owner";
      const refused = await asDevice();
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as { code: string }).code).toBe("HOST_ONLY");
      const asOwner = await app.request(
        "http://127.0.0.1:25150/api/auth/pairing-codes",
        { method: "POST" },
        LOOPBACK_PEER,
      );
      expect(asOwner.status).toBe(200);
      // The device list stays readable: a device sees it, read-only.
      expect((await get("/api/auth/devices", { authorization: `Bearer ${token}` })).status).toBe(
        200,
      );
    });

    test("an agent's request is refused manager and owner routes, and nothing else", async () => {
      const agent = { [AGENT_SESSION_HEADER]: "session-1" };
      const ask = (method: string, path: string) =>
        app.request(`http://127.0.0.1:25150${path}`, { method, headers: agent }, LOOPBACK_PEER);

      for (const [method, path] of [
        ["POST", "/api/updates/apply"],
        ["PUT", "/api/settings/host_management"],
      ] as const) {
        const res = await ask(method, path);
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
        expect(((await res.json()) as { code: string }).code).toBe("AGENT_REFUSED");
      }
      expect((await ask("GET", "/api/updates")).status).toBe(200);
    });

    test("a trailing slash does not step around a guarded route", async () => {
      const { token } = await pair();
      management = "owner";

      const res = await app.request(
        `${BASE}/api/auth/pairing-codes/`,
        { method: "POST", headers: { authorization: `Bearer ${token}` } },
        REMOTE_PEER,
      );

      expect(res.status).toBe(403);
    });

    test("routes the policy never heard of are open to devices and closed to strangers", async () => {
      const { token } = await pair();

      expect((await get("/api/brand-new-route")).status).toBe(401);
      expect((await get("/api/brand-new-route", { authorization: `Bearer ${token}` })).status).toBe(
        200,
      );
    });
  });
});
