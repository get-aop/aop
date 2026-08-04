import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
  });

  describe("GET /details", () => {
    test("returns the dashboard health snapshot", async () => {
      app = createHealthRoutes({
        ctx,
        startTimeMs: Date.now() - 1000,
        getFactoryHealthSnapshot: async () => ({
          generatedAt: "2026-05-15T20:00:00.000Z",
          severity: "warning",
          summary: { ok: 1, warning: 1, error: 0 },
          services: [
            {
              id: "orchestrator",
              label: "Orchestrator",
              severity: "warning",
              message: "Ticker is stopped.",
              action: "Restart the local server before the demo.",
            },
          ],
          integrations: [],
          recentFailures: [],
        }),
      });

      const res = await app.request("/details");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.severity).toBe("warning");
      expect(body.services[0].message).toBe("Ticker is stopped.");
    });
  });
});
