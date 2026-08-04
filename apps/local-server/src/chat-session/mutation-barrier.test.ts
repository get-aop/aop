import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LocalServerContext } from "../context.ts";
import { createTestContext } from "../db/test-utils.ts";
import { createChatSessionService } from "./service.ts";
import { SessionMutationBlockedError } from "./session-mutation-lock.ts";
import { claimNextQueuedSteer } from "./steer-queue.ts";
import { seedChatSessionGraph } from "./test-utils.ts";

const REPO = "repo_barrier";
const SESSION = "csess_barrier";

/**
 * Proves the destructive-maintenance barrier is wired into the real chat entry
 * points, not just available to callers that remember to ask.
 */
describe("chat mutation barrier wiring", () => {
  let ctx: LocalServerContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    await ctx.db
      .insertInto("repos")
      .values({ id: REPO, path: "/tmp/barrier-repo", name: "barrier", remote_origin: null })
      .execute();
    await seedChatSessionGraph(ctx.db, { sessionId: SESSION, repoId: REPO, turns: 1 });
  });

  afterEach(async () => {
    await ctx.db.destroy();
  });

  test("send, retry, steer claim, workspace change, and create are all refused", async () => {
    const service = createChatSessionService(ctx);
    const inside = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const maintenance = ctx.sessionMutationLock.withMaintenance(
      { kind: "repo", repoId: REPO },
      async () => [SESSION],
      async () => {
        inside.resolve();
        await release.promise;
      },
    );
    await inside.promise;

    // Lazily, one at a time: an eagerly created rejected promise would be
    // reported as unhandled before the loop reaches it.
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["send", () => service.sendMessage(SESSION, { content: "hello" })],
      ["retry", () => service.retryFresh(SESSION, `crun_${SESSION}_0`, true)],
      ["workspace", () => service.setWorkspace(SESSION, "/tmp/elsewhere")],
      ["create", () => service.create({ repoId: REPO })],
      ["steer-claim", () => claimNextQueuedSteer(ctx, SESSION, new Set<string>())],
    ];

    for (const [label, attempt] of attempts) {
      await expect(attempt(), label).rejects.toThrow(SessionMutationBlockedError);
    }

    // Nothing slipped through while the barrier was up.
    expect(await ctx.db.selectFrom("chat_sessions").select("id").execute()).toEqual([
      { id: SESSION },
    ]);
    expect(await ctx.db.selectFrom("chat_runs").select("id").execute()).toEqual([
      { id: `crun_${SESSION}_0` },
    ]);

    release.resolve();
    await maintenance;
  });

  test("mutations are allowed again once maintenance finishes", async () => {
    const service = createChatSessionService(ctx);
    await ctx.sessionMutationLock.withMaintenance(
      { kind: "repo", repoId: REPO },
      async () => [SESSION],
      async () => undefined,
    );

    // A blocked guard would throw; a missing session is the expected outcome here.
    expect(await service.setWorkspace("csess_missing", "/tmp/elsewhere")).toMatchObject({
      success: false,
    });
  });
});
