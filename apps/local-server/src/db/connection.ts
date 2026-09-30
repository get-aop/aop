import { Database as BunDatabase } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { aopPaths } from "@aop/infra";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import type { Database } from "./schema.ts";

export const getDefaultDbPath = (): string => aopPaths.db();

export const createDatabase = (dbPath: string): Kysely<Database> => {
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const bunDb = new BunDatabase(dbPath);

  bunDb.run("PRAGMA journal_mode = WAL");
  bunDb.run("PRAGMA busy_timeout = 5000");
  // WAL is durable across app crashes without a full sync on every commit.
  bunDb.run("PRAGMA synchronous = NORMAL");
  bunDb.run("PRAGMA cache_size = -64000");

  return new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: bunDb }),
  });
};
