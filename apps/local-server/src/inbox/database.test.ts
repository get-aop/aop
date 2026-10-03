import { Database as BunDatabase } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { INBOX_MIGRATIONS, migrate, openInboxDatabase } from "./database.ts";

describe("openInboxDatabase", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  test("creates the file owner-only in an owner-only directory, and migrates once", async () => {
    dir = mkdtempSync(join(tmpdir(), "aop-inbox-"));
    const path = join(dir, "inbox", "inbox.db");
    const first = openInboxDatabase(path);
    await first.destroy();
    const second = openInboxDatabase(path);
    const versions = await second.selectFrom("schema_migrations").select("version").execute();
    await second.destroy();

    expect(versions.map((row) => row.version)).toEqual(INBOX_MIGRATIONS.map((m) => m.version));
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("refuses a database written by a newer build", () => {
    const sqlite = new BunDatabase(":memory:");
    migrate(sqlite, INBOX_MIGRATIONS);
    sqlite.run("INSERT INTO schema_migrations (version, name) VALUES (999, 'future')");
    expect(() => migrate(sqlite, INBOX_MIGRATIONS)).toThrow(/newer than this build/);
    sqlite.close();
  });
});
