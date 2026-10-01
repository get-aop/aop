import { describe, expect, test } from "bun:test";
import type { ProjectStack } from "../project/test-utils.ts";
import { coordinatorInbox, spawnAndSettle, started, useThreadWorld } from "./test-utils.ts";

const { setup } = useThreadWorld();

describe("a thread's status as its turns end", () => {
  test("a finished turn leaves it idle with the first line of what it said, unread", async () => {
    const { s, project } = await setup();

    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });

    expect(thread).toMatchObject({ status: "idle", unread: true, repliesCount: 1 });
    expect(thread.liveStatusLine).toContain("Fake reply for turn 1");
  });

  test("a failed turn leaves it idle and says so", async () => {
    const { s, project } = await setup();

    const thread = await spawnAndSettle(s, project.id, {
      title: "Work",
      prompt: "Do it [fake: fail=boom]",
    });

    expect(thread.status).toBe("idle");
    expect(thread.liveStatusLine).toStartWith("Failed:");
  });

  test("a message to an idle thread starts another turn, resumes the session and clears unread", async () => {
    const { s, project } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });
    const firstSession = (await s.ctx.chatSessionRepository.getById(thread.id))?.runtime_session_id;

    const sent = await s.services.threads.send(thread.id, "Also update the docs");

    expect(sent.success && sent.thread).toMatchObject({
      status: "working",
      unread: false,
      liveStatusLine: null,
    });
    await s.settle();
    const after = await s.services.threads.get(thread.id);
    expect(after.success && after.thread).toMatchObject({ status: "idle", repliesCount: 2 });
    expect((await s.ctx.chatSessionRepository.getById(thread.id))?.runtime_session_id).toBe(
      firstSession ?? null,
    );
  });

  test("a message to a working thread reaches its running turn, which answers it", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Work",
      prompt: "Do it [fake: steps=3 delay=150]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await started(s, spawned.thread.id);

    const sent = await s.services.threads.send(spawned.thread.id, "use arm64 instead");
    await s.settle();

    expect(sent.success && sent.thread.status).toBe("working");
    const messages = await s.ctx.chatSessionRepository.listMessages(spawned.thread.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    const [, reply, steer] = messages;
    const runs = await s.db
      .selectFrom("chat_runs")
      .selectAll()
      .where("session_id", "=", spawned.thread.id)
      .execute();
    expect(runs.map((run) => run.status)).toEqual(["completed"]);
    expect(steer?.steered_run_id).toBe(runs[0]?.id ?? "");
    expect(JSON.parse(reply?.parts ?? "[]")).toContainEqual({
      type: "steer",
      messageId: steer?.id,
    });
    expect(reply?.content).toContain("Then you said: use arm64 instead");
    const after = await s.services.threads.get(spawned.thread.id);
    expect(after.success && after.thread).toMatchObject({ status: "idle", repliesCount: 1 });
  });

  test("a message held for after the turn is queued and runs after the current turn", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Work",
      prompt: "Do it [fake: steps=2 delay=150]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await started(s, spawned.thread.id);

    const sent = await s.services.threads.send(spawned.thread.id, "and then this", undefined, {
      midRunMode: "queue",
    });
    await s.settle();

    expect(sent.success && sent.thread.status).toBe("working");
    const messages = await s.ctx.chatSessionRepository.listMessages(spawned.thread.id);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    const after = await s.services.threads.get(spawned.thread.id);
    expect(after.success && after.thread.status).toBe("idle");
  });

  test("a message reopens a resolved thread", async () => {
    const { s, project } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });
    await s.ctx.threadRepository.update(thread.id, {
      status: { status: "resolved", resolvedAt: new Date().toISOString() },
    });

    const sent = await s.services.threads.send(thread.id, "One more thing");

    expect(sent.success && sent.thread.status).toBe("working");
    expect(sent.success && sent.thread).not.toHaveProperty("resolvedAt");
    await s.settle();
  });
});

describe("replying to a thread that is waiting on the person", () => {
  const askFor = (s: ProjectStack, threadId: string) =>
    s.services.threads.askUser(threadId, {
      question: "Which one?",
      options: [
        { label: "a", recommended: false },
        { label: "b", recommended: false },
      ],
    });

  test("the answer clears the question and resumes the runtime session", async () => {
    const { s, project } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });
    const session = (await s.ctx.chatSessionRepository.getById(thread.id))?.runtime_session_id;
    await askFor(s, thread.id);

    const replied = await s.services.threads.reply(thread.id, "b");

    expect(replied.success && replied.thread.status).toBe("working");
    expect(replied.success && replied.thread).not.toHaveProperty("blockedQuestion");
    await s.settle();
    const after = await s.services.threads.get(thread.id);
    expect(after.success && after.thread.status).toBe("idle");
    expect((await s.ctx.chatSessionRepository.getById(thread.id))?.runtime_session_id).toBe(
      session ?? null,
    );
    const [, , answer] = await s.ctx.chatSessionRepository.listMessages(thread.id);
    expect(answer).toMatchObject({ role: "user", content: "b", origin_json: null });
  });

  test("only a thread that is waiting can be replied to", async () => {
    const { s, project } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });

    const reply = await s.services.threads.reply(thread.id, "b");
    const missing = await s.services.threads.reply("isess_nope", "b");

    expect(reply).toEqual({ success: false, error: { code: "NOT_WAITING" } });
    expect(missing).toEqual({ success: false, error: { code: "THREAD_NOT_FOUND" } });
  });

  test("a stopped thread no longer waits", async () => {
    const { s, project } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });
    await askFor(s, thread.id);

    const stopped = await s.services.threads.stop(thread.id);

    expect(stopped.success && stopped.thread).toMatchObject({
      status: "idle",
      liveStatusLine: "Stopped",
    });
    expect(stopped.success && stopped.thread).not.toHaveProperty("blockedQuestion");
  });
});

describe("stopping and deleting a thread", () => {
  test("Stop drops a message sent into the running turn with it: nothing starts afterwards", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Work",
      prompt: "Do it [fake: delay=30000]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await started(s, spawned.thread.id);
    await s.services.threads.send(spawned.thread.id, "sent into the long turn");

    const stopped = await s.services.threads.stop(spawned.thread.id);
    await s.settle();

    expect(stopped.success && stopped.thread.status).toBe("idle");
    const runs = await s.db
      .selectFrom("chat_runs")
      .select(["id", "status"])
      .where("session_id", "=", spawned.thread.id)
      .execute();
    expect(runs.map((run) => run.status)).toEqual(["cancelled"]);
    const steer = await s.db
      .selectFrom("chat_messages")
      .select(["steered_run_id", "disposition"])
      .where("content", "=", "sent into the long turn")
      .executeTakeFirstOrThrow();
    expect(steer).toEqual({ steered_run_id: runs[0]?.id ?? "", disposition: "immediate" });
  }, 30_000);

  test("Stop ends the running turn, drops what was queued, and reports nothing to the coordinator", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Work",
      prompt: "Do it [fake: delay=30000]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await started(s, spawned.thread.id);
    await s.services.threads.send(spawned.thread.id, "queued behind the long turn", undefined, {
      midRunMode: "queue",
    });

    const stopped = await s.services.threads.stop(spawned.thread.id);

    expect(stopped.success && stopped.thread).toMatchObject({
      status: "idle",
      liveStatusLine: "Stopped",
    });
    const runs = await s.db.selectFrom("chat_runs").select("status").execute();
    expect(runs.map((run) => run.status)).toEqual(["cancelled", "cancelled"]);
    await s.settle();
    expect(await coordinatorInbox(s, project.id)).toEqual([]);
  }, 30_000);

  test("deleting a thread stops it, removes its session, and logs thread.removed", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Work",
      prompt: "Do it [fake: delay=30000]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await started(s, spawned.thread.id);

    const removed = await s.services.threads.remove(spawned.thread.id);

    expect(removed).toEqual({ success: true });
    expect(await s.ctx.chatSessionRepository.getById(spawned.thread.id)).toBeNull();
    const last = await s.db
      .selectFrom("event_log")
      .selectAll()
      .orderBy("id", "desc")
      .executeTakeFirst();
    expect(last).toMatchObject({ type: "thread.removed", project_id: project.id });
    expect(JSON.parse(last?.payload ?? "{}")).toEqual({ threadId: spawned.thread.id });
  }, 30_000);

  test("threads that do not exist, or that are a coordinator, are not found", async () => {
    const { s, project } = await setup();
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);

    for (const id of ["isess_nope", coordinator?.id ?? ""]) {
      expect(await s.services.threads.get(id)).toEqual({
        success: false,
        error: { code: "THREAD_NOT_FOUND" },
      });
      expect(await s.services.threads.stop(id)).toEqual({
        success: false,
        error: { code: "THREAD_NOT_FOUND" },
      });
      expect(await s.services.threads.remove(id)).toEqual({
        success: false,
        error: { code: "THREAD_NOT_FOUND" },
      });
      expect(await s.services.threads.listMessages(id)).toEqual({
        success: false,
        error: { code: "THREAD_NOT_FOUND" },
      });
    }
  });
});

describe("marking a thread read", () => {
  test("clears the unread dot and logs it once", async () => {
    const { s, project } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });
    expect(thread.unread).toBe(true);
    const before = await s.db.selectFrom("event_log").select("id").execute();

    const read = await s.services.threads.markRead(thread.id);
    await s.services.threads.markRead(thread.id);

    expect(read.success && read.thread.unread).toBe(false);
    expect(await s.db.selectFrom("event_log").select("id").execute()).toHaveLength(
      before.length + 1,
    );
  });
});
