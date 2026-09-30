import { afterEach, describe, expect, test } from "bun:test";
import type { ChatSession } from "../db/schema.ts";
import { projectSettings, useTempAopHome } from "../project/test-utils.ts";
import {
  type PrWorld,
  reloadThread,
  setupPrWorld,
  spawnWithWork,
} from "../thread/pr-test-utils.ts";

const home = useTempAopHome();
let world: PrWorld | undefined;

afterEach(async () => {
  await world?.s.cleanup();
  world = undefined;
});

const setup = async () => {
  const w = await setupPrWorld(home.path());
  world = w;
  const coordinator = (await w.s.ctx.chatSessionRepository.getCoordinator(
    w.project.id,
  )) as ChatSession;
  return { w, coordinator };
};

const json = (result: { content: { text: string }[] }) =>
  JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;

describe("a thread opening its own pull request", () => {
  test("aop_open_pr opens it with the title and description the thread gives", async () => {
    const { w } = await setup();
    const thread = await spawnWithWork(w);

    const result = await w.s.callTool(thread.id, "aop_open_pr", {
      title: "Lazy-load the ledger",
      body: "Loads it on first use.",
    });

    expect(json(result)).toMatchObject({
      created: true,
      pullRequest: { number: 1, state: "open" },
    });
    expect(w.github.prs[0]).toMatchObject({
      title: "Lazy-load the ledger",
      body: "Loads it on first use.",
    });
    expect((await reloadThread(w.s, thread.id)).artifacts).toHaveLength(1);
  });

  test("calling it again returns the same pull request", async () => {
    const { w } = await setup();
    const thread = await spawnWithWork(w);
    await w.s.callTool(thread.id, "aop_open_pr", {});

    const again = await w.s.callTool(thread.id, "aop_open_pr", {});

    expect(json(again)).toMatchObject({ created: false, pullRequest: { number: 1 } });
    expect(w.github.created()).toBe(1);
  });

  test("a refusal reaches the model as an error it can read", async () => {
    const { w } = await setup();
    const spawned = await w.s.services.threads.spawn(w.project.id, {
      title: "Idle",
      prompt: "look",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await w.s.settle();

    const result = await w.s.callTool(spawned.thread.id, "aop_open_pr", {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("The thread has no changes to open a pull request for");
  });

  test("the coordinator is not offered it", async () => {
    const { w, coordinator } = await setup();

    const { body } = await w.s.mcp(coordinator.id, "tools/call", {
      name: "aop_open_pr",
      arguments: {},
    });

    expect(body.error).toBeDefined();
  });
});

describe("the coordinator's pull request tools", () => {
  test("thread_open_pr, thread_merge_pr and thread_resolve carry a thread from work to done", async () => {
    const { w, coordinator } = await setup();
    const thread = await spawnWithWork(w);

    const opened = json(
      await w.s.callTool(coordinator.id, "thread_open_pr", {
        threadId: thread.id,
        title: "Fix the cold start",
      }),
    );
    const merged = json(
      await w.s.callTool(coordinator.id, "thread_merge_pr", { threadId: thread.id }),
    );
    const resolved = json(
      await w.s.callTool(coordinator.id, "thread_resolve", { threadId: thread.id }),
    );

    expect(opened).toMatchObject({
      created: true,
      pullRequest: { number: 1 },
      thread: { id: thread.id, status: "ready-for-review" },
    });
    expect(merged).toMatchObject({
      id: thread.id,
      status: "resolved",
      pullRequest: { number: 1, state: "merged" },
    });
    expect(resolved).toMatchObject({ id: thread.id, status: "resolved" });
  });

  test("thread_resolve closes out a thread with no pull request", async () => {
    const { w, coordinator } = await setup();
    const thread = await spawnWithWork(w);

    const resolved = json(
      await w.s.callTool(coordinator.id, "thread_resolve", { threadId: thread.id }),
    );

    expect(resolved).toMatchObject({ id: thread.id, status: "resolved" });
  });

  test("a merge GitHub refuses says why, and the thread is still there to fix", async () => {
    const { w, coordinator } = await setup();
    const thread = await spawnWithWork(w);
    await w.s.callTool(coordinator.id, "thread_open_pr", { threadId: thread.id });
    w.github.failMerge('Required status check "ci" has not passed');

    const result = await w.s.callTool(coordinator.id, "thread_merge_pr", { threadId: thread.id });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Required status check");
    expect((await reloadThread(w.s, thread.id)).status).toBe("ready-for-review");
  });

  test("a coordinator cannot open, merge or resolve another project's thread", async () => {
    const { w } = await setup();
    const thread = await spawnWithWork(w);
    const other = await w.s.services.projects.create(projectSettings({ name: "Other" }));
    if (!other.success) throw new Error("project not created");
    const otherCoordinator = (await w.s.ctx.chatSessionRepository.getCoordinator(
      other.project.id,
    )) as ChatSession;

    for (const name of ["thread_open_pr", "thread_merge_pr", "thread_resolve"]) {
      const result = await w.s.callTool(otherCoordinator.id, name, { threadId: thread.id });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe("Thread not found in this project");
    }
    expect(w.github.created()).toBe(0);
    expect((await reloadThread(w.s, thread.id)).status).toBe("idle");
  });
});
