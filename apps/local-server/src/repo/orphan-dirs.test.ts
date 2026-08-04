import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { cleanupOrphanRepoDirs } from "./orphan-dirs.ts";

describe("cleanupOrphanRepoDirs", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("removes repo and worktree dirs with no matching repo row, keeps registered ones", async () => {
    await createTestRepo(db, "repo-live", "/path/to/repo-live");

    mkdirSync(aopPaths.repoDir("repo-live"), { recursive: true });
    mkdirSync(aopPaths.repoDir("repo-orphan"), { recursive: true });
    mkdirSync(aopPaths.worktrees("repo-live"), { recursive: true });
    mkdirSync(aopPaths.worktrees("repo-orphan"), { recursive: true });

    await cleanupOrphanRepoDirs(ctx);

    expect(existsSync(aopPaths.repoDir("repo-live"))).toBe(true);
    expect(existsSync(aopPaths.worktrees("repo-live"))).toBe(true);
    expect(existsSync(aopPaths.repoDir("repo-orphan"))).toBe(false);
    expect(existsSync(aopPaths.worktrees("repo-orphan"))).toBe(false);
  });

  test("ignores plain files and tolerates missing parent directories", async () => {
    mkdirSync(join(aopPaths.home(), "repos"), { recursive: true });
    await Bun.write(join(aopPaths.home(), "repos", "stray-file.txt"), "not a dir");
    // ~/.aop/worktrees intentionally absent.

    await cleanupOrphanRepoDirs(ctx);

    expect(existsSync(join(aopPaths.home(), "repos", "stray-file.txt"))).toBe(true);
  });
});
