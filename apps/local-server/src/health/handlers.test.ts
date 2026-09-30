import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { getHealth, type HealthDeps } from "./handlers.ts";

describe("health handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const makeDeps = (overrides: Partial<HealthDeps> = {}): HealthDeps => ({
    ctx,
    startTimeMs: Date.now() - 5000,
    ...overrides,
  });

  describe("getHealth", () => {
    test("returns ok with service info", async () => {
      const result = await getHealth(makeDeps());

      expect(result.ok).toBe(true);
      expect(result.service).toBe("aop");
      expect(result.db).toEqual({ connected: true });
    });

    test("reports uptime in whole seconds", async () => {
      const result = await getHealth(makeDeps({ startTimeMs: Date.now() - 5_500 }));

      expect(result.uptime).toBe(5);
    });

    test("reports the database as disconnected once it is closed", async () => {
      await db.destroy();
      const result = await getHealth(makeDeps());

      expect(result.db).toEqual({ connected: false });
      db = await createTestDb();
    });
  });
});
