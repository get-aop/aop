import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

const RESUMES_AT = "2026-09-30T16:00:00.000Z";

describe("migration v5", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
    await insertProjectRow(db, "p1");
  });

  afterEach(async () => {
    await db.destroy();
  });

  const update = (id: string, columns: { state?: "rate-limited"; resumes_at?: string | null }) =>
    db.updateTable("chat_sessions").set(columns).where("id", "=", id).execute();

  test("a thread holds resumes_at exactly while it is rate-limited", async () => {
    await insertProjectSession(db, { id: "t1", projectId: "p1", kind: "thread" });

    await expect(update("t1", { resumes_at: RESUMES_AT })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(update("t1", { state: "rate-limited" })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await update("t1", { state: "rate-limited", resumes_at: RESUMES_AT });

    const limited = await db
      .selectFrom("chat_sessions")
      .select("resumes_at")
      .where("id", "=", "t1")
      .executeTakeFirstOrThrow();
    expect(limited.resumes_at).toBe(RESUMES_AT);
  });

  test("a coordinator, which has no state, may wait on a limit at any time", async () => {
    await insertProjectSession(db, { id: "c1", projectId: "p1", kind: "coordinator" });

    await update("c1", { resumes_at: RESUMES_AT });
    await update("c1", { resumes_at: null });
  });

  test("a session outside any project never waits on a limit", async () => {
    await db
      .insertInto("chat_sessions")
      .values({
        id: "plain",
        repo_id: null,
        title: "plain",
        runtime: "claude-code",
        runtime_configuration_id: null,
        model: "m",
        reasoning_effort: "medium",
        runtime_alias: null,
        runtime_session_id: null,
        workspace_path: null,
        project_id: null,
        kind: null,
        state: null,
        blocked_question_json: null,
        last_activity_at: null,
        resolved_at: null,
        resumes_at: null,
        pr_number: null,
        pr_url: null,
        pr_state: null,
        status_line: null,
        branch: null,
      })
      .execute();

    await expect(update("plain", { resumes_at: RESUMES_AT })).rejects.toThrow(
      /CHECK constraint failed/,
    );
  });
});
