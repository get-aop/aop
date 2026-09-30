import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

describe("migration v10", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await runMigrations(db);
    await insertProjectRow(db, "p1");
    await insertProjectSession(db, { id: "coordinator", projectId: "p1", kind: "coordinator" });
    await insertProjectSession(db, { id: "t1", projectId: "p1", kind: "thread" });
    await insertProjectSession(db, { id: "t2", projectId: "p1", kind: "thread" });
    await db
      .insertInto("chat_messages")
      .values(
        ["m1", "m2"].map((id) => ({
          id,
          session_id: "coordinator",
          role: "assistant" as const,
          content: "Options.",
          origin_json: null,
        })),
      )
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const answer = (values: {
    message_id?: string;
    suggestion_id?: string;
    state: "started" | "skipped";
    thread_id: string | null;
  }) =>
    db
      .insertInto("suggestion_answers")
      .values({ message_id: "m1", suggestion_id: "s1", ...values })
      .execute();

  test("a started answer names its thread, and a skipped one names none", async () => {
    await expect(answer({ state: "started", thread_id: null })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(answer({ state: "skipped", thread_id: "t1" })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(answer({ state: "finished" as never, thread_id: "t1" })).rejects.toThrow(
      /CHECK constraint failed/,
    );

    await answer({ state: "started", thread_id: "t1" });
    await answer({ suggestion_id: "s2", state: "skipped", thread_id: null });
  });

  test("a suggestion has one answer, and a thread answers one suggestion", async () => {
    await answer({ state: "started", thread_id: "t1" });

    await expect(answer({ state: "skipped", thread_id: null })).rejects.toThrow(
      /UNIQUE constraint failed/,
    );
    await expect(
      answer({ suggestion_id: "s2", state: "started", thread_id: "t1" }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    await answer({ message_id: "m2", state: "started", thread_id: "t2" });
    await answer({ message_id: "m2", suggestion_id: "s2", state: "skipped", thread_id: null });
  });

  test("an answer needs a message and, when started, a thread that exist", async () => {
    await expect(
      answer({ message_id: "nobody", state: "skipped", thread_id: null }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await expect(answer({ state: "started", thread_id: "nobody" })).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  test("answers go with their message, and a started one goes with its thread, which opens the proposal again", async () => {
    await answer({ state: "started", thread_id: "t1" });
    await answer({ suggestion_id: "s2", state: "skipped", thread_id: null });
    await answer({ message_id: "m2", state: "started", thread_id: "t2" });

    await db.deleteFrom("chat_sessions").where("id", "=", "t1").execute();
    const afterThread = await db.selectFrom("suggestion_answers").selectAll().execute();
    await db.deleteFrom("chat_messages").where("id", "=", "m2").execute();
    const afterMessage = await db.selectFrom("suggestion_answers").selectAll().execute();

    expect(afterThread.map((row) => [row.message_id, row.suggestion_id, row.state])).toEqual([
      ["m1", "s2", "skipped"],
      ["m2", "s1", "started"],
    ]);
    expect(afterMessage.map((row) => [row.message_id, row.suggestion_id, row.state])).toEqual([
      ["m1", "s2", "skipped"],
    ]);
  });
});
