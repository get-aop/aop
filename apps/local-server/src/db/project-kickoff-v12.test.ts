import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

describe("migration v12", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
    await insertProjectRow(db, "p1");
    await insertProjectRow(db, "p2");
    await insertProjectSession(db, { id: "survey", projectId: "p1", kind: "thread" });
  });

  afterEach(async () => {
    await db.destroy();
  });

  const kickoff = (values: {
    project_id?: string;
    state: "pending" | "surveying" | "reported";
    survey_thread_id: string | null;
  }) =>
    db
      .insertInto("project_kickoffs")
      .values({ project_id: "p1", ...values })
      .execute();

  test("a pending kickoff names no survey, and a started one names its survey", async () => {
    await expect(kickoff({ state: "pending", survey_thread_id: "survey" })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(kickoff({ state: "surveying", survey_thread_id: null })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(kickoff({ state: "done" as never, survey_thread_id: "survey" })).rejects.toThrow(
      /CHECK constraint failed/,
    );

    await kickoff({ state: "surveying", survey_thread_id: "survey" });
    await kickoff({ project_id: "p2", state: "pending", survey_thread_id: null });
  });

  test("a project has one kickoff, and a thread is the survey of one project at most", async () => {
    await kickoff({ state: "surveying", survey_thread_id: "survey" });

    await expect(kickoff({ state: "pending", survey_thread_id: null })).rejects.toThrow(
      /UNIQUE constraint failed/,
    );
    await expect(
      kickoff({ project_id: "p2", state: "reported", survey_thread_id: "survey" }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  test("the kickoff goes with its survey thread and with its project", async () => {
    await kickoff({ state: "surveying", survey_thread_id: "survey" });
    await kickoff({ project_id: "p2", state: "pending", survey_thread_id: null });

    await db.deleteFrom("chat_sessions").where("id", "=", "survey").execute();
    await db.deleteFrom("projects").where("id", "=", "p2").execute();

    expect(await db.selectFrom("project_kickoffs").selectAll().execute()).toEqual([]);
  });
});
