import { describe, expect, test } from "bun:test";
import type { RunOptions } from "@aop/llm-provider";
import { stopDispatching } from "../chat-session/run-dispatch.ts";
import { createCommandContext } from "../context.ts";
import { createProjectServices } from "../project/services.ts";
import { eventually, fakeOnlyClaude } from "../project/test-utils.ts";
import { useThreadWorld } from "../thread/test-utils.ts";
import {
  coordinatorReports,
  runOrder,
  setRunCap,
  spawnThread,
  statusesOf,
  threadEvents,
  threadOf,
  untilStarted,
  untilStatus,
  watchRunning,
} from "./test-utils.ts";

// The run queue against the real chat engine, database, event log and the fake CLI. `startup=<ms>`
// makes a turn take that long before its first output, which is how a test holds a slot.

const { setup } = useThreadWorld();

// Consecutive repeats collapsed: a status the stream announced twice in a row is one status.
const distinct = (statuses: string[]): string[] =>
  statuses.filter((status, index) => status !== statuses[index - 1]);

const ids = (threads: { id: string }[]): string[] => threads.map((thread) => thread.id);

describe("the host's cap on running thread turns", () => {
  test("runs one turn at a time under a cap of one, queues the rest, and starts them in the order they came", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    const running = watchRunning(s);

    const first = await spawnThread(s, project.id, "first [fake: startup=1200]");
    const second = await spawnThread(s, project.id, "second [fake: startup=100]");
    const third = await spawnThread(s, project.id, "third [fake: startup=100]");
    const all = ids([first, second, third]);

    expect(await statusesOf(s, all)).toEqual(["working", "queued", "queued"]);
    expect((await threadOf(s, second.id)).liveStatusLine).toBe("Waiting for a free run slot");
    await untilStarted(s, first.id);
    expect(runOrder(s, all)).toEqual([first.id]);

    await untilStatus(s, third.id, "idle");
    await s.settle();

    expect(runOrder(s, all)).toEqual(all);
    expect(await running.stop()).toBe(1);
    expect(await statusesOf(s, all)).toEqual(["idle", "idle", "idle"]);
    expect((await threadOf(s, second.id)).liveStatusLine).not.toBe("Waiting for a free run slot");
  }, 30_000);

  test("the event log carries each thread's move through the queue", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    await spawnThread(s, project.id, "first [fake: startup=800]");
    const second = await spawnThread(s, project.id, "second [fake: startup=100]");

    await untilStatus(s, second.id, "idle");

    expect(distinct(await threadEvents(s, project.id, second.id))).toEqual([
      "working",
      "queued",
      "working",
      "idle",
    ]);
  }, 30_000);

  test("many threads started at once never exceed the cap, and every one runs", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 2);
    const running = watchRunning(s);

    const threads = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        spawnThread(s, project.id, `thread ${index} [fake: startup=250]`),
      ),
    );
    await Promise.all(threads.map((thread) => untilStatus(s, thread.id, "idle")));
    await s.settle();

    expect(runOrder(s, ids(threads))).toHaveLength(6);
    expect(await running.stop()).toBe(2);
  }, 30_000);

  test("raising the cap starts the waiting turns at once", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    const threads = [];
    for (const name of ["a", "b", "c"]) {
      threads.push(await spawnThread(s, project.id, `${name} [fake: startup=1500]`));
    }
    expect(await statusesOf(s, ids(threads))).toEqual(["working", "queued", "queued"]);

    await setRunCap(s, 3);
    await s.services.chat.dispatchQueuedRuns();

    expect(await statusesOf(s, ids(threads))).toEqual(["working", "working", "working"]);
    // They run together, so the order their processes spawn in is not the order they were let in.
    await Promise.all(threads.map((thread) => untilStarted(s, thread.id)));
    await s.settle();
  }, 30_000);

  test("a steer to a running thread waits its turn behind the threads that queued before it", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    const first = await spawnThread(s, project.id, "first [fake: startup=900]");
    const second = await spawnThread(s, project.id, "second [fake: startup=100]");

    const sent = await s.services.threads.send(first.id, "and one more thing [fake: startup=100]");
    expect(sent.success).toBe(true);
    await untilStarted(s, first.id, 2);
    await s.settle();

    expect(runOrder(s, ids([first, second]))).toEqual([first.id, second.id, first.id]);
    expect(await statusesOf(s, ids([first, second]))).toEqual(["idle", "idle"]);
  }, 30_000);

  test("stopping a queued thread ends its wait, and it never runs", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    const first = await spawnThread(s, project.id, "first [fake: startup=900]");
    const second = await spawnThread(s, project.id, "second [fake: startup=100]");
    const third = await spawnThread(s, project.id, "third [fake: startup=100]");

    const stopped = await s.services.threads.stop(second.id);

    expect(stopped.success && stopped.thread).toMatchObject({
      status: "idle",
      liveStatusLine: "Stopped",
    });
    await untilStatus(s, third.id, "idle");
    await s.settle();
    expect(runOrder(s, ids([first, second, third]))).toEqual([first.id, third.id]);
    expect((await threadOf(s, second.id)).status).toBe("idle");
  }, 30_000);
});

describe("a queued turn that cannot start", () => {
  test("fails with the reason, and does not hold up the turns behind it", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    const first = await spawnThread(s, project.id, "first [fake: startup=700]");
    const broken = await spawnThread(s, project.id, "second [fake: startup=100]");
    const third = await spawnThread(s, project.id, "third [fake: startup=100]");
    // Its workspace is removed while it waits.
    await s.ctx.chatSessionRepository.update(broken.id, { workspace_path: "/gone/workspace" });

    await untilStatus(s, third.id, "idle");
    await s.settle();

    expect(runOrder(s, ids([first, broken, third]))).toEqual([first.id, third.id]);
    const failed = await threadOf(s, broken.id);
    expect(failed).toMatchObject({ status: "idle" });
    expect(failed.liveStatusLine).toMatch(/^Failed: This turn could not start: .*does not exist/);
    const [run] = await s.db
      .selectFrom("chat_runs")
      .select(["status", "error_message"])
      .where("session_id", "=", broken.id)
      .execute();
    expect(run).toEqual({
      status: "failed",
      error_message: expect.stringContaining("does not exist"),
    });
    expect(await coordinatorReports(s, project.id)).toContain("failed");
  }, 30_000);

  test("can still be stopped", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    await spawnThread(s, project.id, "first [fake: startup=1500]");
    const waiting = await spawnThread(s, project.id, "second [fake: startup=100]");
    await s.ctx.chatSessionRepository.update(waiting.id, { workspace_path: "/gone/workspace" });

    const stopped = await s.services.threads.stop(waiting.id);

    expect(stopped.success && stopped.thread.status).toBe("idle");
    await s.settle();
  }, 30_000);
});

describe("coordinator turns", () => {
  test("never wait behind thread turns: they are not counted against the cap and never queued", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    const first = await spawnThread(s, project.id, "first [fake: startup=4000]");
    const second = await spawnThread(s, project.id, "second [fake: startup=100]");
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    if (!coordinator) throw new Error("the project has no coordinator");

    const sent = await s.api("POST", `/api/projects/${project.id}/messages`, { text: "Status?" });
    expect(sent.status).toBe(201);
    await untilStarted(s, coordinator.id);
    await eventually(async () => {
      const { body } = await s.api<{ messages: { role: string }[] }>(
        "GET",
        `/api/projects/${project.id}/messages`,
      );
      return body.messages.some((message) => message.role === "assistant") ? true : undefined;
    }, "the coordinator to answer");

    // It answered while the only thread slot was held and another thread waited for it.
    expect(await statusesOf(s, ids([first, second]))).toEqual(["working", "queued"]);
    await s.settle();
  }, 30_000);
});

describe("a thread's report", () => {
  test("wakes the coordinator at once even while every run slot is taken", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    const first = await spawnThread(s, project.id, "first [fake: startup=200]");
    const second = await spawnThread(s, project.id, "second [fake: startup=3000]");
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    if (!coordinator) throw new Error("the project has no coordinator");

    // The first thread finishes, reports, and the second takes the slot it freed.
    await untilStatus(s, first.id, "idle");
    await untilStarted(s, second.id);
    await untilStarted(s, coordinator.id);
    await eventually(async () => {
      const { body } = await s.api<{ messages: { role: string }[] }>(
        "GET",
        `/api/projects/${project.id}/messages`,
      );
      return body.messages.some((message) => message.role === "assistant") ? true : undefined;
    }, "the coordinator to answer the report");

    expect((await threadOf(s, second.id)).status).toBe("working");
    await s.settle();
  }, 30_000);
});

describe("a restart", () => {
  test("keeps the queue, and starts the waiting turns in their order once the server is back", async () => {
    const { s, project } = await setup();
    await setRunCap(s, 1);
    const first = await spawnThread(s, project.id, "first [fake: startup=600]");
    const second = await spawnThread(s, project.id, "second [fake: startup=100]");
    const third = await spawnThread(s, project.id, "third [fake: startup=100]");
    const waiting = ids([second, third]);

    // The server stops: the turn that is running finishes and frees its slot, and nothing that
    // was waiting starts.
    stopDispatching(s.ctx);
    await untilStatus(s, first.id, "idle");
    await s.settle();
    expect(runOrder(s, ids([first, second, third]))).toEqual([first.id]);
    expect(await statusesOf(s, waiting)).toEqual(["queued", "queued"]);

    // The server starts again over the same database, with nothing but what is stored.
    const started: RunOptions[] = [];
    createProjectServices(createCommandContext(s.db), {
      createProviderFn: () => ({
        name: "claude-code",
        run: (options) => {
          started.push(options);
          return fakeOnlyClaude.run(options);
        },
      }),
      recoveryPollIntervalMs: 20,
    });
    await untilStatus(s, third.id, "idle");
    await s.settle();

    const threadRuns = started
      .map((run) => run.env?.AOP_CHAT_SESSION_ID ?? "")
      .filter((id) => waiting.includes(id));
    expect(threadRuns).toEqual(waiting);
    expect(await statusesOf(s, waiting)).toEqual(["idle", "idle"]);
  }, 30_000);
});
