import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DESKTOP_APP_ORIGIN, PairedDeviceSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "./test-utils.ts";

const HOST = "https://mac.tail1234.ts.net";
const OTHER_TRUSTED_PAGE = "http://localhost:5173";

describe("cross-origin access to the API", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;

  const remote = (path: string, init: RequestInit = {}) =>
    app.request(`${HOST}${path}`, init, REMOTE_PEER);
  const pairDevice = async (): Promise<string> => {
    const issued = await app.request(
      "http://127.0.0.1:25150/api/auth/pairing-codes",
      { method: "POST" },
      LOOPBACK_PEER,
    );
    const { code } = (await issued.json()) as AnyJson;
    const res = await remote("/api/auth/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Work laptop" }),
    });
    return PairedDeviceSchema.parse(await res.json()).token;
  };

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp({
      ctx: createCommandContext(db),
      startTimeMs: Date.now(),
      allowedOrigins: [DESKTOP_APP_ORIGIN, OTHER_TRUSTED_PAGE],
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("the browser's preflight", () => {
    const preflight = (origin: string) =>
      remote("/api/projects", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });

    test("lets the desktop app's page send a bearer token, with no credentials to configure", async () => {
      const res = await preflight(DESKTOP_APP_ORIGIN);

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(DESKTOP_APP_ORIGIN);
      const allowedHeaders = res.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
      expect(allowedHeaders).toContain("authorization");
      expect(allowedHeaders).toContain("content-type");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      expect(res.headers.get("vary")).toContain("Origin");
    });

    test("lets an origin the operator listed do the same", async () => {
      const res = await preflight(OTHER_TRUSTED_PAGE);

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(OTHER_TRUSTED_PAGE);
    });

    test("refuses a page on any other origin before CORS can grant it anything", async () => {
      for (const origin of ["https://evil.example", "null", "app://other"]) {
        const res = await preflight(origin);

        expect(res.status).toBe(403);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
      }
    });
  });

  describe("the request itself", () => {
    test("a paired device on the desktop origin is who it says it is, and can read the answer", async () => {
      const token = await pairDevice();

      const res = await remote("/api/auth/me", {
        headers: { origin: DESKTOP_APP_ORIGIN, authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(DESKTOP_APP_ORIGIN);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
      expect(((await res.json()) as AnyJson).kind).toBe("device");
    });

    test("an unpaired page still reads the 401, so it can show its pairing screen", async () => {
      const res = await remote("/api/auth/me", { headers: { origin: DESKTOP_APP_ORIGIN } });

      expect(res.status).toBe(401);
      expect(res.headers.get("access-control-allow-origin")).toBe(DESKTOP_APP_ORIGIN);
      expect(((await res.json()) as AnyJson).code).toBe("UNAUTHENTICATED");
    });

    test("lets the page read how long a rate limit lasts", async () => {
      const res = await remote("/api/auth/me", { headers: { origin: DESKTOP_APP_ORIGIN } });

      expect(res.headers.get("access-control-expose-headers")).toContain("Retry-After");
    });

    test("the desktop app running a host on its own Mac reaches it as the owner, with no token", async () => {
      const res = await app.request(
        "http://127.0.0.1:25150/api/auth/me",
        { headers: { origin: DESKTOP_APP_ORIGIN } },
        LOOPBACK_PEER,
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ kind: "owner" });
    });

    test("a page on a site that only names the desktop scheme's host is not the desktop app", async () => {
      const res = await remote("/api/auth/me", { headers: { origin: "https://aop" } });

      expect(res.status).toBe(403);
    });

    test("a request without an Origin, such as the CLI's, gets no CORS headers", async () => {
      const res = await remote("/api/auth/me");

      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
