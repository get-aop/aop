import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

const updateSettings = async (db: Kysely<Database>): Promise<Record<string, string>> =>
  Object.fromEntries(
    (await db.selectFrom("settings").selectAll().execute())
      .filter((row) => row.key.startsWith("update_"))
      .map((row) => [row.key, row.value]),
  );

describe("migration v27 on a database that ran versions 1 to 26", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(26));
    // An older build stored only the old key; this build's defaults were seeded by the line above.
    await db.deleteFrom("settings").where("key", "like", "update_%").execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const storeAutoApply = (value: string) =>
    sql`INSERT INTO settings (key, value) VALUES ('update_auto_apply', ${value})`.execute(db);

  test("a host that installed by itself keeps doing so, once no turn is running", async () => {
    await storeAutoApply("true");

    await runMigrations(db);

    const settings = await updateSettings(db);
    expect(settings.update_install).toBe("idle");
    expect(settings).not.toHaveProperty("update_auto_apply");
  });

  test("a host that had it off is asked, and gets the new keys' defaults", async () => {
    await storeAutoApply("false");

    await runMigrations(db);

    expect(await updateSettings(db)).toEqual({
      update_check: "true",
      update_install: "ask",
      update_install_window: "01:00-06:00",
      update_background_download: "true",
    });
  });

  test("a host without the old key gets this build's default", async () => {
    await runMigrations(db);

    // Tests run as the stable channel, which asks.
    expect((await updateSettings(db)).update_install).toBe("ask");
  });
});
