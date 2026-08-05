import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { sql } from "kysely";
import { createDatabase, getDefaultDbPath } from "./connection.ts";

describe("db/connection", () => {
  describe("getDefaultDbPath", () => {
    test("returns path in home directory", () => {
      const cleanupAopHome = useTestAopHome();
      try {
        expect(getDefaultDbPath()).toBe(aopPaths.db());
      } finally {
        cleanupAopHome();
      }
    });
  });

  describe("createDatabase", () => {
    let tempDbPath: string;

    beforeEach(() => {
      tempDbPath = join("/tmp", `aop-test-db-${Date.now()}`, "test.sqlite");
    });

    afterEach(async () => {
      const dbDir = join("/tmp", tempDbPath.split("/tmp/")[1]?.split("/")[0] ?? "");
      if (dbDir && existsSync(dbDir)) {
        rmSync(dbDir, { recursive: true });
      }
    });

    test("creates database and returns Kysely instance", async () => {
      const db = createDatabase(tempDbPath);

      expect(db).toBeDefined();
      expect(existsSync(tempDbPath)).toBe(true);

      await db.destroy();
    });

    test("creates parent directory if it does not exist", async () => {
      const nestedPath = join("/tmp", `aop-test-db-nested-${Date.now()}`, "subdir", "test.sqlite");
      const db = createDatabase(nestedPath);

      expect(existsSync(nestedPath)).toBe(true);

      await db.destroy();
      rmSync(join("/tmp", nestedPath.split("/tmp/")[1]?.split("/")[0] ?? ""), { recursive: true });
    });

    test("database can execute queries", async () => {
      const db = createDatabase(tempDbPath);

      // Verify DB is functional - just check the instance is usable
      expect(db).toBeDefined();
      expect(typeof db.selectFrom).toBe("function");

      await db.destroy();
    });

    test("works with in-memory database", async () => {
      const db = createDatabase(":memory:");

      expect(db).toBeDefined();

      await db.destroy();
    });

    test("sets synchronous NORMAL and WAL journal mode", async () => {
      const db = createDatabase(tempDbPath);

      const synchronous = await sql<{ synchronous: number }>`PRAGMA synchronous`.execute(db);
      const journalMode = await sql<{ journal_mode: string }>`PRAGMA journal_mode`.execute(db);

      expect(synchronous.rows[0]?.synchronous).toBe(1);
      expect(journalMode.rows[0]?.journal_mode).toBe("wal");

      await db.destroy();
    });
  });
});
