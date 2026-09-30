import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SuggestionAnswer } from "@aop/common";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createSuggestionRepository, type SuggestionRepository } from "./repository.ts";

describe("suggestion repository", () => {
  let db: Kysely<Database>;
  let answers: SuggestionRepository;

  beforeEach(async () => {
    db = await createTestDb();
    answers = createSuggestionRepository(db);
    await insertProjectRow(db, "p1");
    await insertProjectSession(db, { id: "coordinator", projectId: "p1", kind: "coordinator" });
    for (const id of ["t1", "t2"]) {
      await insertProjectSession(db, { id, projectId: "p1", kind: "thread" });
    }
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

  test("a suggestion nobody answered has no answer", async () => {
    expect(await answers.get("m1", "s1")).toBeNull();
    expect(await answers.listForMessages(["m1", "m2"])).toEqual(new Map());
    expect(await answers.listForMessages([])).toEqual(new Map());
  });

  test("a start is recorded with its thread, and a second start is refused and changes nothing", async () => {
    expect(await answers.recordStarted("m1", "s1", "t1")).toBe(true);
    expect(await answers.recordStarted("m1", "s1", "t2")).toBe(false);

    expect(await answers.get("m1", "s1")).toEqual({ state: "started", threadId: "t1" });
  });

  test("starts that race for the same suggestion have one winner", async () => {
    const outcomes = await Promise.all([
      answers.recordStarted("m1", "s1", "t1"),
      answers.recordStarted("m1", "s1", "t2"),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await db.selectFrom("suggestion_answers").select("thread_id").execute()).toHaveLength(1);
  });

  test("a skip is recorded once, and never replaces an answer that is there", async () => {
    expect(await answers.recordSkipped("m1", "s1")).toBe(true);
    expect(await answers.recordSkipped("m1", "s1")).toBe(false);
    await answers.recordStarted("m1", "s2", "t1");
    expect(await answers.recordSkipped("m1", "s2")).toBe(false);

    expect(await answers.get("m1", "s1")).toEqual({ state: "skipped" });
    expect(await answers.get("m1", "s2")).toEqual({ state: "started", threadId: "t1" });
  });

  test("a start replaces a skip", async () => {
    await answers.recordSkipped("m1", "s1");

    expect(await answers.recordStarted("m1", "s1", "t1")).toBe(true);

    expect(await answers.get("m1", "s1")).toEqual({ state: "started", threadId: "t1" });
  });

  test("only a skip can be taken back", async () => {
    await answers.recordSkipped("m1", "s1");
    await answers.recordStarted("m1", "s2", "t1");

    expect(await answers.clearSkipped("m1", "s1")).toBe(true);
    expect(await answers.clearSkipped("m1", "s1")).toBe(false);
    expect(await answers.clearSkipped("m1", "s2")).toBe(false);

    expect(await answers.get("m1", "s1")).toBeNull();
    expect(await answers.get("m1", "s2")).toEqual({ state: "started", threadId: "t1" });
  });

  test("lists the answers of several messages, by message and suggestion", async () => {
    await answers.recordStarted("m1", "s1", "t1");
    await answers.recordSkipped("m1", "s2");
    await answers.recordSkipped("m2", "s1");

    const listed = await answers.listForMessages(["m1", "m2"]);
    const started: SuggestionAnswer = { state: "started", threadId: "t1" };
    const skipped: SuggestionAnswer = { state: "skipped" };

    const expected = new Map<string, Map<string, SuggestionAnswer>>([
      [
        "m1",
        new Map<string, SuggestionAnswer>([
          ["s1", started],
          ["s2", skipped],
        ]),
      ],
      ["m2", new Map<string, SuggestionAnswer>([["s1", skipped]])],
    ]);
    expect(listed).toEqual(expected);
    expect((await answers.listForMessages(["m2"])).has("m1")).toBe(false);
  });

  test("names the messages a thread was started from", async () => {
    await answers.recordStarted("m1", "s1", "t1");
    await answers.recordStarted("m2", "s1", "t2");
    await answers.recordSkipped("m2", "s2");

    expect(await answers.messagesStartedAs("t1")).toEqual(["m1"]);
    expect(await answers.messagesStartedAs("nobody")).toEqual([]);
  });

  test("a write through a transaction's database commits with it or not at all", async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await createSuggestionRepository(trx).recordStarted("m1", "s1", "t1");
        throw new Error("the rest of the transaction failed");
      }),
    ).rejects.toThrow("the rest of the transaction failed");

    expect(await answers.get("m1", "s1")).toBeNull();
  });
});
