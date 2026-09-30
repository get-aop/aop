import { describe, expect, test } from "bun:test";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import { coordinatorInbox, spawnAndSettle, started, useThreadWorld } from "./test-utils.ts";

const { setup } = useThreadWorld();

describe("reporting to the coordinator", () => {
  test("a finished turn lands in the coordinator's inbox as a thread report, and the coordinator answers it", async () => {
    const { s, project } = await setup();

    const thread = await spawnAndSettle(s, project.id, { title: "Audit retries", prompt: "Audit" });

    const inbox = await coordinatorInbox(s, project.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.content).toStartWith(
      `Thread report: "Audit retries" (${thread.id}) finished a turn`,
    );
    expect(parseMessageOrigin(inbox[0]?.origin_json ?? null)).toEqual({
      type: "thread-report",
      threadId: thread.id,
      outcome: "finished",
    });
    const messages = await s.services.projects.listMessages(project.id);
    const roles = messages.success ? messages.messages.map((message) => message.role) : [];
    expect(roles).toEqual(["thread-report", "assistant"]);
    const answer = messages.success ? messages.messages[1] : undefined;
    expect(answer?.role === "assistant" && answer.blocks.at(-1)).toEqual({
      type: "thread-card",
      threadId: thread.id,
      variant: "done",
    });
  });

  test("a failed turn is reported as failed", async () => {
    const { s, project } = await setup();

    const thread = await spawnAndSettle(s, project.id, {
      title: "Audit",
      prompt: "Audit [fake: fail=boom]",
    });

    const [report] = await coordinatorInbox(s, project.id);
    expect(parseMessageOrigin(report?.origin_json ?? null)).toEqual({
      type: "thread-report",
      threadId: thread.id,
      outcome: "failed",
    });
    expect(report?.content).toContain("failed.");
  });

  test("a thread that asks for the person's call reports needs-you with the question, and the card says so", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Audit",
      prompt: "Audit [fake: delay=200]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await started(s, spawned.thread.id);
    await s.services.threads.askUser(spawned.thread.id, {
      question: "Which one?",
      options: [{ label: "a", recommended: true }],
    });
    await s.settle();

    const [report] = await coordinatorInbox(s, project.id);
    expect(parseMessageOrigin(report?.origin_json ?? null)).toMatchObject({ outcome: "needs-you" });
    expect(report?.content).toContain("waiting on the person to decide: Which one?");
    expect(report?.content).toContain("- a");
    const messages = await s.services.projects.listMessages(project.id);
    const answer = messages.success ? messages.messages.at(-1) : undefined;
    expect(answer?.role === "assistant" && answer.blocks.at(-1)).toMatchObject({
      type: "thread-card",
      variant: "needs-call",
    });
  });

  test("a thread with a message still queued reports only when its last turn ends", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Work",
      prompt: "Do it [fake: steps=1 delay=200]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await started(s, spawned.thread.id);
    await s.services.threads.send(spawned.thread.id, "and this");
    await s.settle();

    expect(await coordinatorInbox(s, project.id)).toHaveLength(1);
  });

  test("the reports and every state change reach the event log", async () => {
    const { s, project } = await setup();

    await spawnAndSettle(s, project.id, { title: "Work", prompt: "Do it" });

    const types = (await s.db.selectFrom("event_log").select("type").orderBy("id").execute()).map(
      (row) => row.type,
    );
    expect(types[0]).toBe("project.upserted");
    expect(types.filter((type) => type === "thread.upserted").length).toBeGreaterThanOrEqual(3);
    // The relay, the thread's reply, the report, and the coordinator's answer.
    expect(types.filter((type) => type === "message.created")).toHaveLength(4);
  });
});
