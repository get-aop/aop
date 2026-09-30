import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { serializeMessageOrigin } from "../chat-session/message-origin.ts";
import type { ChatSession, Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "./test-utils.ts";
import { listWireMessages, type MessagePageRequest, UNKNOWN_PAGE_ANCHOR } from "./wire-messages.ts";

describe("listWireMessages paging and failed replies", () => {
  let db: Kysely<Database>;
  let coordinator: ChatSession;
  let thread: ChatSession;

  beforeEach(async () => {
    db = await createTestDb();
    await insertProjectRow(db, "proj_1");
    await insertProjectSession(db, { id: "isess_coord", projectId: "proj_1", kind: "coordinator" });
    await insertProjectSession(db, { id: "isess_thread", projectId: "proj_1", kind: "thread" });
    coordinator = await db
      .selectFrom("chat_sessions")
      .selectAll()
      .where("id", "=", "isess_coord")
      .executeTakeFirstOrThrow();
    thread = await db
      .selectFrom("chat_sessions")
      .selectAll()
      .where("id", "=", "isess_thread")
      .executeTakeFirstOrThrow();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const list = async (session: ChatSession, request?: MessagePageRequest) => {
    const page = await listWireMessages(db, session, request);
    if (!page) throw new Error("the page was refused");
    return page;
  };

  let clock = 0;
  const at = (): string => new Date(Date.UTC(2026, 8, 30, 10, 0, clock++)).toISOString();

  const addMessage = (
    sessionId: string,
    values: {
      id: string;
      role: "user" | "assistant";
      content: string;
      origin?: Parameters<typeof serializeMessageOrigin>[0];
      turn: number;
    },
  ) =>
    db
      .insertInto("chat_messages")
      .values({
        id: values.id,
        session_id: sessionId,
        role: values.role,
        content: values.content,
        turn_index: values.turn,
        created_at: at(),
        origin_json: values.origin ? serializeMessageOrigin(values.origin) : null,
      })
      .execute();
  describe("paging", () => {
    const fillCoordinator = async (turns: number) => {
      for (let turn = 1; turn <= turns; turn++) {
        await addMessage(coordinator.id, {
          id: `m${turn}`,
          role: "user",
          content: `message ${turn}`,
          turn,
        });
      }
    };
    const ids = (page: { messages: { id: string }[] }) => page.messages.map(({ id }) => id);

    test("says whether older messages remain, and pages back from the oldest one held until none do", async () => {
      await fillCoordinator(7);

      const latest = await list(coordinator, { limit: 3 });
      const middle = await list(coordinator, { limit: 3, before: "m5" });
      const oldest = await list(coordinator, { limit: 3, before: "m2" });

      expect([ids(latest), latest.hasMore]).toEqual([["m5", "m6", "m7"], true]);
      expect([ids(middle), middle.hasMore]).toEqual([["m2", "m3", "m4"], true]);
      expect([ids(oldest), oldest.hasMore]).toEqual([["m1"], false]);
    });

    test("has no more when the page is exactly the rest of the conversation", async () => {
      await fillCoordinator(3);

      const exact = await list(coordinator, { limit: 3 });
      const before = await list(coordinator, { limit: 2, before: "m3" });

      expect([ids(exact), exact.hasMore]).toEqual([["m1", "m2", "m3"], false]);
      expect([ids(before), before.hasMore]).toEqual([["m1", "m2"], false]);
    });

    test("orders messages of one turn by time, then id, so no page repeats or skips one", async () => {
      await addMessage(coordinator.id, { id: "u1", role: "user", content: "one", turn: 1 });
      await addMessage(coordinator.id, { id: "a1", role: "assistant", content: "reply", turn: 1 });
      await addMessage(coordinator.id, { id: "u2", role: "user", content: "two", turn: 2 });
      await addMessage(coordinator.id, {
        id: "a2",
        role: "assistant",
        content: "reply 2",
        turn: 2,
      });

      const newest = await list(coordinator, { limit: 2 });
      const older = await list(coordinator, { limit: 2, before: "u2" });

      expect(ids(newest)).toEqual(["u2", "a2"]);
      expect(ids(older)).toEqual(["u1", "a1"]);
    });

    test("goes on past a page of messages with nothing to show, so the client is never left with no message to page from", async () => {
      await addMessage(coordinator.id, { id: "m1", role: "user", content: "real", turn: 1 });
      for (const turn of [2, 3, 4]) {
        await addMessage(coordinator.id, { id: `blank${turn}`, role: "user", content: "", turn });
      }
      await addMessage(coordinator.id, { id: "m5", role: "user", content: "newest", turn: 5 });

      const older = await list(coordinator, { limit: 2, before: "m5" });

      expect([ids(older), older.hasMore]).toEqual([["m1"], false]);
    });

    test("a message that is not one of this conversation's is no place to page from", async () => {
      await fillCoordinator(2);
      await addMessage(thread.id, { id: "t1", role: "user", content: "elsewhere", turn: 1 });

      expect(await listWireMessages(db, coordinator, { before: "nope" })).toBeNull();
      expect(await listWireMessages(db, coordinator, { before: "t1" })).toBeNull();
      expect(UNKNOWN_PAGE_ANCHOR).toContain("no such message");
    });
  });

  describe("a reply whose run failed", () => {
    const addRun = (
      values: { id: string; user: string; assistant: string; status: "failed" | "completed" },
      failureKind: "rate_limit" | null = null,
    ) =>
      db
        .insertInto("chat_runs")
        .values({
          id: values.id,
          session_id: coordinator.id,
          user_message_id: values.user,
          assistant_message_id: values.assistant,
          runtime: "claude-code",
          log_file_path: "/tmp/x.jsonl",
          status: values.status,
          failure_kind: failureKind,
        })
        .execute();

    test("is marked failed, and so is nothing else: not a completed run, not a usage limit's wait", async () => {
      await addMessage(coordinator.id, { id: "u1", role: "user", content: "a", turn: 1 });
      await addMessage(coordinator.id, { id: "a1", role: "assistant", content: "fine", turn: 1 });
      await addRun({ id: "crun_1", user: "u1", assistant: "a1", status: "completed" });
      await addMessage(coordinator.id, { id: "u2", role: "user", content: "b", turn: 2 });
      await addMessage(coordinator.id, {
        id: "a2",
        role: "assistant",
        content: "Runtime error: spawn claude ENOENT",
        turn: 2,
      });
      await addRun({ id: "crun_2", user: "u2", assistant: "a2", status: "failed" });
      await addMessage(coordinator.id, { id: "u3", role: "user", content: "c", turn: 3 });
      await addMessage(coordinator.id, {
        id: "a3",
        role: "assistant",
        content: "You've hit your session limit",
        turn: 3,
      });
      await addRun({ id: "crun_3", user: "u3", assistant: "a3", status: "failed" }, "rate_limit");

      const { messages } = await list(coordinator);

      const failed = Object.fromEntries(
        messages.flatMap((message) =>
          message.role === "assistant" ? [[message.id, message.failed ?? false]] : [],
        ),
      );
      expect(failed).toEqual({ a1: false, a2: true, a3: false });
      const [, , , failedReply] = messages;
      expect(failedReply).toMatchObject({
        blocks: [{ type: "text", text: "Runtime error: spawn claude ENOENT" }],
      });
    });
  });
});
