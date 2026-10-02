import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { API_VERSION, HostHealthSchema, MIN_CLIENT_API_VERSION } from "@aop/common";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createHealthRoutes } from "./routes.ts";

describe("health routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: ReturnType<typeof createHealthRoutes>;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = createHealthRoutes({ ctx, startTimeMs: Date.now() - 1000 });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("GET /", () => {
    test("returns ok status with service info", async () => {
      const res = await app.request("/");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.service).toBe("aop");
      expect(body.db).toEqual({ connected: true });
    });

    test("tells a client which API this host speaks, in a shape the client's schema reads", async () => {
      const res = await app.request("/");

      expect(HostHealthSchema.parse(await res.json())).toEqual({
        service: "aop",
        version: expect.any(String),
        channel: "stable",
        apiVersion: API_VERSION,
        minClientApiVersion: MIN_CLIENT_API_VERSION,
      });
    });

    test("reports the build version the installer set", async () => {
      process.env.AOP_BUILD_VERSION = "9.9.9";
      try {
        const body: AnyJson = await (await app.request("/")).json();
        expect(body.version).toBe("9.9.9");
      } finally {
        delete process.env.AOP_BUILD_VERSION;
      }
    });
  });
});
