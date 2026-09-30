import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

// biome-ignore lint/suspicious/noExplicitAny: JSON responses in tests need flexible typing
export type AnyJson = any;

export const createTestContext = async (): Promise<LocalServerContext> => {
  const db = await createTestDb();
  return createCommandContext(db);
};

export const createTestDb = async (): Promise<Kysely<Database>> => {
  const db = createDatabase(":memory:");
  await runMigrations(db);
  return db;
};

export const createTestRepo = async (
  db: Kysely<Database>,
  id: string,
  path: string,
): Promise<void> => {
  const repoPath = path.startsWith(`${tmpdir()}/`) ? path : aopPaths.repoDir(id);
  await rm(aopPaths.repoDir(id), { recursive: true, force: true });
  await rm(repoPath, { recursive: true, force: true });
  await mkdir(repoPath, { recursive: true });
  await initializeGitRepo(repoPath);
  await db
    .insertInto("repos")
    .values({
      id,
      path: repoPath,
      name: path.split("/").pop() ?? null,
      remote_origin: null,
    })
    .execute();
};

const initializeGitRepo = async (repoPath: string): Promise<void> => {
  execFileSync("git", ["init", "-b", "main", repoPath]);
  execFileSync("git", ["-C", repoPath, "config", "user.email", "aop-tests@example.com"]);
  execFileSync("git", ["-C", repoPath, "config", "user.name", "AOP Tests"]);
  await writeFile(join(repoPath, ".gitkeep"), "");
  execFileSync("git", ["-C", repoPath, "add", ".gitkeep"]);
  execFileSync("git", ["-C", repoPath, "commit", "-m", "init"]);
};
