import { beforeEach, describe, expect, test } from "bun:test";
import type { Thread, TurnPart } from "@aop/common";
import type { ChatSession } from "../db/schema.ts";
import { eventually, insertProjectSession } from "../project/test-utils.ts";
import { coordinatorInbox, started, useThreadWorld } from "./test-utils.ts";
import { resetThreadToolHealth } from "./tool-health.ts";

const { setup } = useThreadWorld();

// Calls are remembered per process, so another file's calls for the same session id must not count here.
beforeEach(() => resetThreadToolHealth());

const aopCall = (id: string, status: "running" | "done" | "failed"): TurnPart => ({
  type: "tool",
  id,
  name: "mcp aop aop ask user",
  detail: null,
  status,
});

const workingThread = async () => {
  const { s, project } = await setup();
  await insertProjectSession(s.db, { id: "isess_w", projectId: project.id, kind: "thread" });
  const session = (await s.ctx.chatSessionRepository.getById("isess_w")) as ChatSession;
  const read = async (): Promise<Thread> => {
    const found = await s.services.threads.get("isess_w");
    if (!found.success) throw new Error("thread vanished");
    return found.thread;
  };
  // The flag is written after the progress hook returns; give it the moment it takes.
  const settled = async () => {
    await Bun.sleep(50);
    await s.settle();
  };
  return { s, project, session, read, settled };
};

const degradedOf = (thread: Thread) => (thread.status === "working" ? thread.degraded : undefined);

describe("a thread whose AOP tools stop reaching the host", () => {
  test("is marked degraded when its transcript shows an AOP call that failed and never arrived", async () => {
    const { s, project, session, read, settled } = await workingThread();

    s.ctx.sessionHooks.onAssistantProgress(session, runOf(session), [aopCall("toolu_1", "failed")]);
    const degraded = await eventually(async () => degradedOf(await read()), "the degraded mark");
    await settled();

    expect(degraded).toMatchObject({
      reason: expect.stringContaining("mcp aop aop ask user failed before it reached the host"),
    });
    const inbox = await coordinatorInbox(s, project.id);
    expect(inbox.map((message) => message.content.split("\n")[0])).toEqual([
      'Thread report: "isess_w" (isess_w) lost its AOP tools. Its call to mcp aop aop ask user failed before it reached the host: the AOP tools cannot reach the host.',
    ]);
  });

  test("is not marked for an AOP call that reached the host and failed there", async () => {
    const { s, session, read, settled } = await workingThread();

    await s.services.toolHealth.accepted(session, { toolUseId: "toolu_1" });
    s.services.toolHealth.turnProgress(session, [aopCall("toolu_1", "failed")]);
    await settled();

    expect(degradedOf(await read())).toBeUndefined();
  });

  test("is not marked while a call is still running, however long it takes, nor for other tools", async () => {
    const { s, session, read, settled } = await workingThread();

    s.services.toolHealth.turnProgress(session, [
      aopCall("toolu_1", "running"),
      { type: "tool", id: "toolu_2", name: "Bash", detail: "make", status: "failed" },
      { type: "tool", id: "toolu_3", name: "mcp github create pr", detail: null, status: "failed" },
    ]);
    await settled();

    expect(degradedOf(await read())).toBeUndefined();
  });

  test("a call that arrives again clears the mark", async () => {
    const { s, session, read, settled } = await workingThread();
    s.services.toolHealth.turnProgress(session, [aopCall("toolu_1", "failed")]);
    await eventually(async () => degradedOf(await read()), "the degraded mark");
    await settled();
    const marked = (await s.ctx.chatSessionRepository.getById("isess_w")) as ChatSession;

    await s.services.toolHealth.accepted(marked);

    expect(degradedOf(await read())).toBeUndefined();
  });

  test("the end of the turn clears the mark", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Long",
      prompt: "Work [fake: delay=400]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await started(s, spawned.thread.id);
    await s.services.toolHealth.authFailed(spawned.thread.id);
    const marked = await s.services.threads.get(spawned.thread.id);
    expect(marked.success && degradedOf(marked.thread)).toBeTruthy();

    await s.settle();

    const ended = await s.services.threads.get(spawned.thread.id);
    expect(ended.success && ended.thread.status).not.toBe("working");
    expect(ended.success && "degraded" in ended.thread).toBe(false);
  });
});

const runOf = (session: ChatSession) =>
  ({
    id: "run_x",
    session_id: session.id,
    assistant_message_id: "msg_a",
    user_message_id: "msg_u",
  }) as never;
