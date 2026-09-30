import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MessageSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { encodeMessageContent } from "../chat-session/message-images.ts";
import { serializeMessageOrigin } from "../chat-session/message-origin.ts";
import type { ChatSession, Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "./test-utils.ts";
import { listWireMessages } from "./wire-messages.ts";

describe("listWireMessages", () => {
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

  test("maps a person's message, the coordinator's reply and a thread report to the wire types", async () => {
    await addMessage(coordinator.id, { id: "m1", role: "user", content: "Fix checkout", turn: 1 });
    await addMessage(coordinator.id, { id: "m2", role: "assistant", content: "On it.", turn: 1 });
    await addMessage(coordinator.id, {
      id: "m3",
      role: "user",
      content: 'Thread report: "Fix" (isess_thread) finished a turn.',
      origin: { type: "thread-report", threadId: "isess_thread", outcome: "finished" },
      turn: 2,
    });

    const messages = await listWireMessages(db, coordinator);

    expect(messages).toMatchObject([
      { id: "m1", role: "user", text: "Fix checkout", threadId: null, projectId: "proj_1" },
      { id: "m2", role: "assistant", blocks: [{ type: "text", text: "On it." }] },
      {
        id: "m3",
        role: "thread-report",
        reportedThreadId: "isess_thread",
        outcome: "finished",
        threadId: null,
      },
    ]);
    for (const message of messages) expect(MessageSchema.safeParse(message).success).toBe(true);
  });

  test("a brief the coordinator relayed into a thread is an assistant message with the forwarded quote first", async () => {
    await addMessage(thread.id, {
      id: "m1",
      role: "user",
      content: "Redate the draft",
      origin: { type: "coordinator-relay", quote: "release moved to Monday" },
      turn: 1,
    });
    await addMessage(thread.id, {
      id: "m2",
      role: "user",
      content: "Audit the retries",
      origin: { type: "coordinator-relay", quote: null },
      turn: 2,
    });
    await addMessage(thread.id, { id: "m3", role: "user", content: "b", turn: 3 });

    const messages = await listWireMessages(db, thread);

    expect(messages).toMatchObject([
      {
        role: "assistant",
        threadId: "isess_thread",
        blocks: [
          { type: "quote-forwarded", text: "release moved to Monday" },
          { type: "text", text: "Redate the draft" },
        ],
      },
      { role: "assistant", blocks: [{ type: "text", text: "Audit the retries" }] },
      { role: "user", text: "b", threadId: "isess_thread" },
    ]);
  });

  test("an assistant message is its text followed by the blocks its run's tools produced", async () => {
    await addMessage(coordinator.id, { id: "u1", role: "user", content: "Start it", turn: 1 });
    await addMessage(coordinator.id, { id: "a1", role: "assistant", content: "Started.", turn: 1 });
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_1",
        session_id: coordinator.id,
        user_message_id: "u1",
        assistant_message_id: "a1",
        runtime: "claude-code",
        log_file_path: "/tmp/x.jsonl",
        status: "completed",
        blocks_json: JSON.stringify([
          { type: "thread-card", threadId: "isess_thread", variant: "live" },
          { type: "routing-receipt", threadIds: ["isess_thread", "isess_other"] },
        ]),
      })
      .execute();

    const [, reply] = await listWireMessages(db, coordinator);

    expect(reply).toMatchObject({
      role: "assistant",
      blocks: [
        { type: "text", text: "Started." },
        { type: "thread-card", threadId: "isess_thread", variant: "live" },
        { type: "routing-receipt", threadIds: ["isess_thread", "isess_other"] },
      ],
    });
  });

  test("a block stored in a shape this build no longer reads is left out, and the rest of the conversation still loads", async () => {
    await addMessage(coordinator.id, { id: "u1", role: "user", content: "Start it", turn: 1 });
    await addMessage(coordinator.id, { id: "a1", role: "assistant", content: "Started.", turn: 1 });
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_old",
        session_id: coordinator.id,
        user_message_id: "u1",
        assistant_message_id: "a1",
        runtime: "claude-code",
        log_file_path: "/tmp/x.jsonl",
        status: "completed",
        blocks_json: JSON.stringify([
          { type: "routing-receipt", count: 2 },
          { type: "thread-card", threadId: "isess_thread", variant: "live" },
        ]),
      })
      .execute();

    const [, reply] = await listWireMessages(db, coordinator);

    expect(reply).toMatchObject({
      role: "assistant",
      blocks: [
        { type: "text", text: "Started." },
        { type: "thread-card", threadId: "isess_thread", variant: "live" },
      ],
    });
  });

  test("the coordinator's thread links become chips inside its reply; a thread's own text is left as written", async () => {
    const link = "Passed it to [Fix login](thread:isess_thread) now.";
    await addMessage(coordinator.id, { id: "c1", role: "assistant", content: link, turn: 1 });
    await addMessage(thread.id, { id: "t1", role: "assistant", content: link, turn: 1 });

    const [coordinatorReply] = await listWireMessages(db, coordinator);
    const [threadReply] = await listWireMessages(db, thread);

    expect(coordinatorReply).toMatchObject({
      role: "assistant",
      blocks: [
        { type: "text", text: "Passed it to " },
        { type: "thread-chip", threadId: "isess_thread" },
        { type: "text", text: " now." },
      ],
    });
    expect(threadReply).toMatchObject({
      role: "assistant",
      blocks: [{ type: "text", text: link }],
    });
  });

  test("leaves out a message with nothing to show, and expands pasted text", async () => {
    await addMessage(coordinator.id, {
      id: "image-only",
      role: "user",
      content: encodeMessageContent("", [
        { id: "i1", fileName: "smsg_x-1.png", mimeType: "image/png" },
      ]),
      turn: 1,
    });
    await addMessage(coordinator.id, {
      id: "empty-reply",
      role: "assistant",
      content: "  ",
      turn: 1,
    });
    await addMessage(coordinator.id, { id: "real", role: "user", content: "hello", turn: 2 });

    const messages = await listWireMessages(db, coordinator);

    expect(messages.map((message) => message.id)).toEqual(["real"]);
  });

  test("returns the latest messages, oldest first, when there are more than the limit", async () => {
    for (let turn = 1; turn <= 5; turn++) {
      await addMessage(coordinator.id, {
        id: `m${turn}`,
        role: "user",
        content: `message ${turn}`,
        turn,
      });
    }

    const messages = await listWireMessages(db, coordinator, 3);

    expect(messages.map((message) => message.id)).toEqual(["m3", "m4", "m5"]);
  });

  test("a stored origin that no longer parses fails loudly instead of showing the wrong thing", async () => {
    await db
      .insertInto("chat_messages")
      .values({
        id: "bad",
        session_id: coordinator.id,
        role: "user",
        content: "hi",
        turn_index: 1,
        created_at: at(),
        origin_json: '{"type":"from-the-future"}',
      })
      .execute();

    await expect(listWireMessages(db, coordinator)).rejects.toThrow();
  });

  test("a session that belongs to no project has no wire messages", async () => {
    await db
      .insertInto("chat_sessions")
      .values({
        id: "isess_plain",
        title: "Plain",
        runtime: "claude-code",
        model: "m",
        reasoning_effort: "medium",
        runtime_configuration_id: null,
        runtime_alias: null,
        runtime_session_id: null,
        workspace_path: null,
        repo_id: null,
      })
      .execute();
    const plain = await db
      .selectFrom("chat_sessions")
      .selectAll()
      .where("id", "=", "isess_plain")
      .executeTakeFirstOrThrow();

    await expect(listWireMessages(db, plain)).rejects.toThrow("belongs to no project");
  });
});
