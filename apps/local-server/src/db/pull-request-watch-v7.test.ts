import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

const CHECKS = JSON.stringify({ state: "failure", successful: 1, failing: 1, pending: 0 });

describe("migration v7", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
    await insertProjectRow(db, "p1");
  });

  afterEach(async () => {
    await db.destroy();
  });

  const setChecks = (id: string, checks: string | null) =>
    db.updateTable("chat_sessions").set({ pr_checks_json: checks }).where("id", "=", id).execute();

  const pullRequest = {
    pr_number: 7,
    pr_url: "https://github.com/acme/widget/pull/7",
    pr_state: "open",
  } as const;

  test("a project has auto-fix on unless it says otherwise, and holds only 0 or 1", async () => {
    const project = await db
      .selectFrom("projects")
      .select("auto_fix_pull_requests")
      .where("id", "=", "p1")
      .executeTakeFirstOrThrow();
    expect(project.auto_fix_pull_requests).toBe(1);

    await expect(
      db
        .updateTable("projects")
        .set({ auto_fix_pull_requests: 2 as never })
        .execute(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  test("only a thread that has a pull request holds a checks summary, and it is a JSON object", async () => {
    await insertProjectSession(db, { id: "t1", projectId: "p1", kind: "thread" });
    await expect(setChecks("t1", CHECKS)).rejects.toThrow(/CHECK constraint failed/);

    await insertProjectSession(db, { id: "t2", projectId: "p1", kind: "thread" }, pullRequest);
    await setChecks("t2", CHECKS);
    await expect(setChecks("t2", "[]")).rejects.toThrow(/CHECK constraint failed/);
    await expect(setChecks("t2", "not json")).rejects.toThrow(/CHECK constraint failed/);
    await setChecks("t2", null);
  });

  test("the watcher's entries are a JSON array, one row per thread, and go with the thread", async () => {
    await insertProjectSession(db, { id: "t1", projectId: "p1", kind: "thread" });
    const insert = (entries: string) =>
      db.insertInto("pull_request_watch").values({ thread_id: "t1", entries_json: entries });

    await expect(insert("{}").execute()).rejects.toThrow(/CHECK constraint failed/);
    await insert("[]").execute();
    await expect(insert("[]").execute()).rejects.toThrow(/UNIQUE constraint failed/);
    await expect(
      db
        .insertInto("pull_request_watch")
        .values({ thread_id: "nobody", entries_json: "[]" })
        .execute(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await db.deleteFrom("chat_sessions").where("id", "=", "t1").execute();

    expect(await db.selectFrom("pull_request_watch").select("thread_id").execute()).toEqual([]);
  });
});
