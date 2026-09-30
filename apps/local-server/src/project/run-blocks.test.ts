import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MessageBlock } from "@aop/common";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createRunBlocks } from "./run-blocks.ts";
import { insertProjectRow, insertProjectSession } from "./test-utils.ts";

describe("createRunBlocks", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
    await insertProjectRow(db, "proj_1");
    await insertProjectSession(db, { id: "isess_coord", projectId: "proj_1", kind: "coordinator" });
  });

  afterEach(async () => {
    await db.destroy();
  });

  const startRun = async (status: "running" | "completed" = "running") => {
    for (const [id, role] of [
      ["u1", "user"],
      ["a1", "assistant"],
    ] as const) {
      await db
        .insertInto("chat_messages")
        .values({ id, session_id: "isess_coord", role, content: role, turn_index: 1 })
        .execute();
    }
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_1",
        session_id: "isess_coord",
        user_message_id: "u1",
        assistant_message_id: "a1",
        runtime: "claude-code",
        log_file_path: "/tmp/x.jsonl",
        status,
      })
      .execute();
  };

  const storedBlocks = async (): Promise<MessageBlock[]> => {
    const run = await db
      .selectFrom("chat_runs")
      .select("blocks_json")
      .where("id", "=", "crun_1")
      .executeTakeFirstOrThrow();
    return JSON.parse(run.blocks_json);
  };

  test("the receipt names each thread the reply routed a message to, in the order they were reached", async () => {
    await startRun();
    const blocks = createRunBlocks(db);

    await blocks.routedTo("isess_coord", "thr_a");
    await blocks.append("isess_coord", { type: "thread-card", threadId: "thr_a", variant: "live" });
    await blocks.routedTo("isess_coord", "thr_b");

    expect(await storedBlocks()).toEqual([
      { type: "routing-receipt", threadIds: ["thr_a", "thr_b"] },
      { type: "thread-card", threadId: "thr_a", variant: "live" },
    ]);
  });

  test("steering the same thread twice still reads 'Sent to one thread'", async () => {
    await startRun();
    const blocks = createRunBlocks(db);

    await blocks.routedTo("isess_coord", "thr_a");
    await blocks.routedTo("isess_coord", "thr_a");

    expect(await storedBlocks()).toEqual([{ type: "routing-receipt", threadIds: ["thr_a"] }]);
  });

  test("nothing is attached when no reply is being written", async () => {
    await startRun("completed");
    const blocks = createRunBlocks(db);

    expect(await blocks.routedTo("isess_coord", "thr_a")).toBe(false);
    expect(
      await blocks.append("isess_coord", {
        type: "thread-card",
        threadId: "thr_a",
        variant: "live",
      }),
    ).toBe(false);
    expect(await storedBlocks()).toEqual([]);
  });
});
