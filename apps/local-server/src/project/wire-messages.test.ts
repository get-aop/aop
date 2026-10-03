import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MessageSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { encodeMessageContent } from "../chat-session/message-images.ts";
import { serializeMessageOrigin } from "../chat-session/message-origin.ts";
import type { ChatSession, Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "./test-utils.ts";
import { getWireMessage, listWireMessages, type MessagePageRequest } from "./wire-messages.ts";

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
      parts?: unknown[];
      activity?: unknown;
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
        parts: values.parts ? JSON.stringify(values.parts) : null,
        activity: values.activity ? JSON.stringify(values.activity) : null,
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

    const { messages } = await list(coordinator);

    expect(messages).toMatchObject([
      {
        id: "m1",
        role: "user",
        sender: "person",
        text: "Fix checkout",
        threadId: null,
        projectId: "proj_1",
      },
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

  test("a message written into a running turn names the reply that turn writes", async () => {
    await addMessage(coordinator.id, { id: "m1", role: "user", content: "Plan it", turn: 1 });
    await addMessage(coordinator.id, { id: "m2", role: "user", content: "Skip the beta", turn: 2 });
    await addMessage(thread.id, { id: "t0", role: "user", content: "Build it", turn: 1 });
    await addMessage(thread.id, {
      id: "t1",
      role: "user",
      content: "Use arm64",
      origin: { type: "coordinator-relay", quote: null },
      turn: 2,
    });
    const run = (id: string, sessionId: string, userMessageId: string, reply: string) => ({
      id,
      session_id: sessionId,
      user_message_id: userMessageId,
      assistant_message_id: reply,
      runtime: "claude-code",
      log_file_path: `/tmp/${id}.jsonl`,
      status: "running" as const,
    });
    await db
      .insertInto("chat_runs")
      .values([run("crun_c", coordinator.id, "m1", "m3"), run("crun_t", thread.id, "t0", "t9")])
      .execute();
    await db
      .updateTable("chat_messages")
      .set({ steered_run_id: "crun_c" })
      .where("id", "=", "m2")
      .execute();
    await db
      .updateTable("chat_messages")
      .set({ steered_run_id: "crun_t" })
      .where("id", "=", "t1")
      .execute();

    expect((await list(coordinator)).messages).toMatchObject([
      { id: "m1", role: "user" },
      { id: "m2", role: "user", text: "Skip the beta", steers: "m3" },
    ]);
    expect((await list(coordinator)).messages[0]).not.toHaveProperty("steers");
    // The coordinator's words relayed into a thread keep their sender, and say where they went.
    expect((await list(thread)).messages).toMatchObject([
      { id: "t0", role: "user", sender: "person" },
      { id: "t1", role: "user", sender: "coordinator", steers: "t9" },
    ]);
  });

  test("each message to a thread names its sender: the coordinator's brief with the person's quote, a steer, the person, a routine, AOP", async () => {
    await addMessage(thread.id, {
      id: "m1",
      role: "user",
      content: "Redate the draft",
      origin: { type: "coordinator-relay", quote: "release moved to Monday", brief: true },
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
    await addMessage(thread.id, {
      id: "m4",
      role: "user",
      content: "CI failed on the PR. Fix it.",
      origin: { type: "pull-request-watch", claimId: "fix_1" },
      turn: 4,
    });
    await addMessage(thread.id, {
      id: "m5",
      role: "user",
      content: 'This thread was started by the routine "Deps".\n\nCheck the deps',
      origin: { type: "routine", routineId: "rtn_1", name: "Deps", prompt: "Check the deps" },
      turn: 5,
    });

    const { messages } = await list(thread);

    expect(messages).toEqual([
      expect.objectContaining({
        role: "user",
        threadId: "isess_thread",
        sender: "coordinator",
        brief: true,
        quote: "release moved to Monday",
        text: "Redate the draft",
      }),
      expect.objectContaining({ role: "user", sender: "coordinator", text: "Audit the retries" }),
      expect.objectContaining({ role: "user", sender: "person", text: "b" }),
      expect.objectContaining({
        role: "user",
        sender: "system",
        text: "CI failed on the PR. Fix it.",
      }),
      expect.objectContaining({
        role: "user",
        sender: "routine",
        brief: true,
        routine: { id: "rtn_1", name: "Deps" },
        text: "Check the deps",
      }),
    ]);
    // Only a brief says so, and only a forward carries a quote.
    expect(messages[1]).not.toHaveProperty("brief");
    expect(messages[1]).not.toHaveProperty("quote");
    expect(messages[2]).not.toHaveProperty("brief");
  });

  test("a routine's message to the coordinator is the routine's, and no brief", async () => {
    await addMessage(coordinator.id, {
      id: "m1",
      role: "user",
      content: "[Routine] Check the deps",
      origin: { type: "routine", routineId: "rtn_1", name: "Deps", prompt: "Check the deps" },
      turn: 1,
    });

    const [message] = (await list(coordinator)).messages;

    expect(message).toMatchObject({ role: "user", sender: "routine", text: "Check the deps" });
    expect(message).not.toHaveProperty("brief");
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

    const [, reply] = (await list(coordinator)).messages;

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

    const [, reply] = (await list(coordinator)).messages;

    expect(reply).toMatchObject({
      role: "assistant",
      blocks: [
        { type: "text", text: "Started." },
        { type: "thread-card", threadId: "isess_thread", variant: "live" },
      ],
    });
  });

  describe("the answers to suggested threads", () => {
    const suggestions = ["s1", "s2", "s3"].map((id) => ({
      id,
      title: `Thread ${id}`,
      prompt: "Do it.",
      repoId: null,
    }));

    const propose = async (messageId: string) => {
      await addMessage(coordinator.id, {
        id: `u-${messageId}`,
        role: "user",
        content: "Go",
        turn: 1,
      });
      await addMessage(coordinator.id, {
        id: messageId,
        role: "assistant",
        content: "Options.",
        turn: 1,
      });
      await db
        .insertInto("chat_runs")
        .values({
          id: `crun-${messageId}`,
          session_id: coordinator.id,
          user_message_id: `u-${messageId}`,
          assistant_message_id: messageId,
          runtime: "claude-code",
          log_file_path: "/tmp/x.jsonl",
          status: "completed",
          blocks_json: JSON.stringify([{ type: "suggested-threads", suggestions }]),
        })
        .execute();
    };

    const answered = (message: unknown) =>
      (message as { blocks: { suggestions?: { id: string; answer?: unknown }[] }[] }).blocks
        .flatMap((block) => block.suggestions ?? [])
        .map(({ id, answer }) => [id, answer ?? null]);

    test("are put on the suggestions of the message they were given for, and on no other", async () => {
      await propose("a1");
      await propose("a2");
      await insertProjectSession(db, { id: "isess_started", projectId: "proj_1", kind: "thread" });
      await db
        .insertInto("suggestion_answers")
        .values([
          { message_id: "a1", suggestion_id: "s1", state: "started", thread_id: "isess_started" },
          { message_id: "a1", suggestion_id: "s3", state: "skipped", thread_id: null },
        ])
        .execute();

      const { messages } = await list(coordinator);
      const one = await getWireMessage(db, coordinator, "a1");
      const two = await getWireMessage(db, coordinator, "a2");

      const expectedOne = [
        ["s1", { state: "started", threadId: "isess_started" }],
        ["s2", null],
        ["s3", { state: "skipped" }],
      ];
      expect(answered(messages.find(({ id }) => id === "a1"))).toEqual(expectedOne);
      expect(answered(one)).toEqual(expectedOne);
      expect(answered(messages.find(({ id }) => id === "a2"))).toEqual(
        ["s1", "s2", "s3"].map((id) => [id, null]),
      );
      expect(answered(two)).toEqual(["s1", "s2", "s3"].map((id) => [id, null]));
      for (const message of messages) expect(MessageSchema.safeParse(message).success).toBe(true);
    });

    test("are not part of what the run stored", async () => {
      await propose("a1");
      await db
        .insertInto("suggestion_answers")
        .values({ message_id: "a1", suggestion_id: "s2", state: "skipped", thread_id: null })
        .execute();

      await listWireMessages(db, coordinator);

      const run = await db
        .selectFrom("chat_runs")
        .select("blocks_json")
        .where("assistant_message_id", "=", "a1")
        .executeTakeFirstOrThrow();
      expect(run.blocks_json).not.toContain("skipped");
    });

    test("getWireMessage finds one message by id, and none in another session or that does not exist", async () => {
      await propose("a1");

      expect(await getWireMessage(db, coordinator, "a1")).toMatchObject({ id: "a1" });
      expect(await getWireMessage(db, thread, "a1")).toBeNull();
      expect(await getWireMessage(db, coordinator, "nope")).toBeNull();
    });
  });

  test("a reply is the parts its turn stored, in order; a thread link stays in its text for the client to show as a chip", async () => {
    const link = "Passed it to [Fix login](thread:isess_thread) now.";
    const parts = [
      { type: "thinking", text: "Who owns login?" },
      { type: "tool", id: "t1", name: "mcp aop thread steer", detail: null, status: "done" },
      { type: "text", text: link },
    ];
    await addMessage(coordinator.id, {
      id: "c1",
      role: "assistant",
      content: link,
      turn: 1,
      parts,
    });

    const [reply] = (await list(coordinator)).messages;

    expect(reply).toMatchObject({ role: "assistant", blocks: parts });
  });

  test("a reply stored before parts existed is read from its activity and its text", async () => {
    await addMessage(thread.id, {
      id: "t1",
      role: "assistant",
      content: "Fixed.",
      turn: 1,
      activity: {
        thinking: "",
        content: "Looking.\n\nFixed.",
        commandGroups: [
          { id: "cg_1", commands: [{ id: "c1", command: "Bash", detail: "ls", status: "done" }] },
        ],
      },
    });

    const [reply] = (await list(thread)).messages;

    expect(reply).toMatchObject({
      role: "assistant",
      blocks: [
        { type: "text", text: "Looking." },
        { type: "tool", id: "c1", name: "Bash", detail: "ls", status: "done" },
        { type: "text", text: "Fixed." },
      ],
    });
  });

  test("leaves out a message with nothing to show", async () => {
    await addMessage(coordinator.id, {
      id: "empty-reply",
      role: "assistant",
      content: "  ",
      turn: 1,
    });
    await addMessage(coordinator.id, { id: "real", role: "user", content: "hello", turn: 2 });

    const { messages } = await list(coordinator);

    expect(messages.map((message) => message.id)).toEqual(["real"]);
  });

  test("a person's images come with their message, where the project serves them, even with no text", async () => {
    await addMessage(coordinator.id, {
      id: "image-only",
      role: "user",
      content: encodeMessageContent("", [
        { id: "img_a", fileName: "smsg_x-1.png", mimeType: "image/png" },
      ]),
      turn: 1,
    });
    await addMessage(coordinator.id, {
      id: "with-text",
      role: "user",
      content: encodeMessageContent("compare these", [
        { id: "img_b", fileName: "smsg_y-1.jpg", mimeType: "image/jpeg" },
        { id: "img_c", fileName: "smsg_y-2.webp", mimeType: "image/webp" },
      ]),
      turn: 2,
    });

    const { messages } = await list(coordinator);

    expect(messages).toMatchObject([
      {
        id: "image-only",
        role: "user",
        text: "",
        images: [
          { id: "img_a", mimeType: "image/png", path: "/projects/proj_1/images/smsg_x-1.png" },
        ],
      },
      {
        id: "with-text",
        text: "compare these",
        images: [
          { id: "img_b", mimeType: "image/jpeg", path: "/projects/proj_1/images/smsg_y-1.jpg" },
          { id: "img_c", mimeType: "image/webp", path: "/projects/proj_1/images/smsg_y-2.webp" },
        ],
      },
    ]);
    for (const message of messages) expect(MessageSchema.safeParse(message).success).toBe(true);
  });

  test("a message without images has no images field", async () => {
    await addMessage(coordinator.id, { id: "plain", role: "user", content: "hello", turn: 1 });

    const { messages } = await list(coordinator);

    expect(messages[0]).not.toHaveProperty("images");
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

    const { messages } = await list(coordinator, { limit: 3 });

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
