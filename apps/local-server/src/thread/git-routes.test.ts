import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createProjectStack, projectSettings, useTempAopHome } from "../project/test-utils.ts";
import { type PrWorld, setupPrWorld, spawnWithWork, worktreeOf } from "./pr-test-utils.ts";

const home = useTempAopHome();
let world: PrWorld | undefined;

afterEach(async () => {
  await world?.s.cleanup();
  world = undefined;
});

const setup = async () => {
  world = await setupPrWorld(home.path());
  return world;
};

interface PullRequestBody {
  thread: { status: string; artifacts: { type: string; number: number; state: string }[] };
  pullRequest: { number: number; state: string };
  created: boolean;
}

describe("the pull request routes", () => {
  test("opening answers 201 with the pull request, and 200 with the same one the next time", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    const first = await w.s.api<PullRequestBody>("POST", `/api/threads/${thread.id}/pull-request`);
    const second = await w.s.api<PullRequestBody>(
      "POST",
      `/api/threads/${thread.id}/pull-request`,
      {
        title: "Something else",
      },
    );

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      created: true,
      pullRequest: { number: 1, state: "open" },
      thread: { status: "ready-for-review" },
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ created: false, pullRequest: { number: 1 } });
    expect(w.github.created()).toBe(1);
  });

  test("takes a title, a description and a draft flag, and refuses a body that is not that", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    const bad = await w.s.api("POST", `/api/threads/${thread.id}/pull-request`, { draft: "yes" });
    const good = await w.s.api("POST", `/api/threads/${thread.id}/pull-request`, {
      title: "Lazy-load the ledger",
      body: "Loads it on first use.",
      draft: true,
    });

    expect(bad.status).toBe(400);
    expect(good.status).toBe(201);
    expect(w.github.prs[0]).toMatchObject({ title: "Lazy-load the ledger", draft: true });
  });

  test("says why it cannot: an unknown thread is 404, a thread with nothing to publish is 409", async () => {
    const w = await setup();
    const spawned = await w.s.services.threads.spawn(w.project.id, {
      title: "Idle",
      prompt: "look",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await w.s.settle();

    const unknown = await w.s.api("POST", "/api/threads/isess_nope/pull-request");
    const nothing = await w.s.api("POST", `/api/threads/${spawned.thread.id}/pull-request`);

    expect(unknown.status).toBe(404);
    expect(nothing.status).toBe(409);
    expect(nothing.body).toMatchObject({ code: "NOTHING_TO_PUBLISH" });
  });

  test("a thread with no repository is 409", async () => {
    const stack = await createProjectStack(home.path(), { repos: 0 });
    const created = await stack.services.projects.create(projectSettings({}));
    if (!created.success) throw new Error("project not created");
    const spawned = await stack.services.threads.spawn(created.project.id, {
      title: "Sketch",
      prompt: "sketch",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await stack.settle();

    const opened = await stack.api("POST", `/api/threads/${spawned.thread.id}/pull-request`);

    expect(opened.status).toBe(409);
    expect(opened.body).toMatchObject({ code: "NO_REPOSITORY" });
    await stack.cleanup();
  });

  test("merging answers with the resolved thread, and 409 when there is no pull request or GitHub refuses", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    const none = await w.s.api("POST", `/api/threads/${thread.id}/pull-request/merge`);
    await w.s.api("POST", `/api/threads/${thread.id}/pull-request`);
    w.github.failMerge("merge conflict");
    const conflict = await w.s.api("POST", `/api/threads/${thread.id}/pull-request/merge`, {
      method: "merge",
    });
    w.github.failMerge(null);
    const merged = await w.s.api<{ thread: { status: string } }>(
      "POST",
      `/api/threads/${thread.id}/pull-request/merge`,
    );
    const badMethod = await w.s.api("POST", `/api/threads/${thread.id}/pull-request/merge`, {
      method: "fast-forward",
    });

    expect(none.status).toBe(409);
    expect(none.body).toMatchObject({ code: "NO_PULL_REQUEST" });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "PULL_REQUEST_FAILED", error: "merge conflict" });
    expect(merged.status).toBe(200);
    expect(merged.body.thread.status).toBe("resolved");
    expect(badMethod.status).toBe(400);
  });

  test("syncing brings in a merge made on GitHub", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);
    await w.s.api("POST", `/api/threads/${thread.id}/pull-request`);
    w.github.mergeOnGithub(1);

    const synced = await w.s.api<PullRequestBody>(
      "POST",
      `/api/threads/${thread.id}/pull-request/sync`,
    );

    expect(synced.status).toBe(200);
    expect(synced.body.thread).toMatchObject({
      status: "resolved",
      artifacts: [{ type: "pr", number: 1, state: "merged" }],
    });
  });

  test("resolving answers with the resolved thread and deleting removes its worktree", async () => {
    const w = await setup();
    const thread = await spawnWithWork(w);

    const resolved = await w.s.api<{ thread: { status: string } }>(
      "POST",
      `/api/threads/${thread.id}/resolve`,
    );
    const removed = await w.s.api("DELETE", `/api/threads/${thread.id}`);

    expect(resolved.status).toBe(200);
    expect(resolved.body.thread.status).toBe("resolved");
    expect(removed.status).toBe(204);
    expect(existsSync(worktreeOf(w, thread))).toBe(false);
  });
});
