import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

describe("migration v27 on a database that ran versions 1 to 26", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(26));
    await sql`
      INSERT INTO devices (id, name, token_hash, created_at, last_seen_at)
      VALUES ('d1', 'Work Mac', 'hash-1', '2026-10-01T09:00:00.000Z', '2026-10-02T09:00:00.000Z')
    `.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("keeps every paired device, with no client until it next connects", async () => {
    await runMigrations(db);

    const rows = await db.selectFrom("devices").selectAll().execute();
    expect(rows).toEqual([
      {
        id: "d1",
        name: "Work Mac",
        token_hash: "hash-1",
        created_at: "2026-10-01T09:00:00.000Z",
        last_seen_at: "2026-10-02T09:00:00.000Z",
        client_app: null,
        client_version: null,
        client_platform: null,
      },
    ]);
  });

  test("stores the client a device reports", async () => {
    await runMigrations(db);

    await db
      .updateTable("devices")
      .set({ client_app: "desktop", client_version: "0.10.8", client_platform: "darwin" })
      .where("id", "=", "d1")
      .execute();

    const row = await db
      .selectFrom("devices")
      .select(["client_app", "client_version", "client_platform"])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      client_app: "desktop",
      client_version: "0.10.8",
      client_platform: "darwin",
    });
  });
});
