import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

describe("migration v6", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
    await insertProjectRow(db, "p1");
    for (const id of ["repo_a", "repo_b"]) {
      await db
        .insertInto("repos")
        .values({ id, path: `/work/${id}`, name: id, remote_origin: null })
        .execute();
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  const thread = (id: string, repoId: string, pr: number | null) =>
    insertProjectSession(
      db,
      { id, projectId: "p1", kind: "thread" },
      {
        repo_id: repoId,
        ...(pr !== null && {
          pr_number: pr,
          pr_url: `https://github.com/acme/widget/pull/${pr}`,
          pr_state: "open" as const,
        }),
      },
    );

  test("two threads of one repo cannot hold the same pull request", async () => {
    await thread("t1", "repo_a", 7);

    await expect(thread("t2", "repo_a", 7)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  test("the same number in another repo is another pull request", async () => {
    await thread("t1", "repo_a", 7);

    await thread("t2", "repo_b", 7);

    expect(await db.selectFrom("chat_sessions").select("id").execute()).toHaveLength(2);
  });

  test("threads without a pull request are not constrained, and a thread may open a different one", async () => {
    await thread("t1", "repo_a", null);
    await thread("t2", "repo_a", null);
    await thread("t3", "repo_a", 8);

    expect(await db.selectFrom("chat_sessions").select("id").execute()).toHaveLength(3);
  });
});
