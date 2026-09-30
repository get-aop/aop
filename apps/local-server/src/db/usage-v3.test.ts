import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedChatSessionGraph } from "../chat-session/test-utils.ts";
import { BASELINE_V1_STATEMENTS } from "./baseline-v1.ts";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import { PROJECTS_V2_STATEMENTS } from "./projects-v2.ts";

describe("migration v3 on a database file", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aop-usage-v3-"));
    path = join(dir, "projects.sqlite");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("a version 2 file gains an empty run_usage table and keeps its runs", async () => {
    const v2 = createDatabase(path);
    await applyMigrations(v2, [
      { version: 1, name: "baseline", statements: BASELINE_V1_STATEMENTS },
      { version: 2, name: "projects", statements: PROJECTS_V2_STATEMENTS },
    ]);
    await seedChatSessionGraph(v2, { sessionId: "old", turns: 2, withCheckpoints: false });
    await v2.destroy();

    const db = createDatabase(path);
    await runMigrations(db);
    await runMigrations(db);

    const ledger = await db.selectFrom("schema_migrations").select("version").execute();
    expect(ledger.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await db.selectFrom("run_usage").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("chat_runs").select("id").execute()).toHaveLength(2);
    await db.destroy();
  });
});
