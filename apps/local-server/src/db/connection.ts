import { Database as BunDatabase } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { aopPaths } from "@aop/infra";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import type { Database } from "./schema.ts";

export const getDefaultDbPath = (): string => aopPaths.db();

const BUN_DB_HANDLE = Symbol("aopBunDbHandle");

interface BunDbHandle {
  bunDb: BunDatabase;
  dbPath: string;
}

/** Raw handle behind a Kysely instance (shared for in-memory test databases). */
export const getBunDbHandle = (db: Kysely<Database>): BunDbHandle | null =>
  (db as unknown as { [BUN_DB_HANDLE]?: BunDbHandle })[BUN_DB_HANDLE] ?? null;

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

  const kysely = new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: bunDb }),
  });
  (kysely as unknown as { [BUN_DB_HANDLE]: BunDbHandle })[BUN_DB_HANDLE] = { bunDb, dbPath };
  return kysely;
};

/**
 * Second, read-only connection over the same database file. In WAL mode its
 * reads never queue behind the writer connection's transactions, so dashboard
 * polls (status, session lists) stay responsive while session writes commit.
 * In-memory test databases share the writer handle instead.
 */
export const createReadOnlyDatabase = (db: Kysely<Database>): Kysely<Database> => {
  const handle = getBunDbHandle(db);
  if (!handle || handle.dbPath === ":memory:") {
    return db;
  }

  const readBunDb = new BunDatabase(handle.dbPath, { readonly: true });
  readBunDb.run("PRAGMA busy_timeout = 5000");
  return new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: readBunDb }),
  });
};
