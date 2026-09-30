import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { aopPaths } from "@aop/infra";
import { spawnAndSettle, useThreadWorld } from "./test-utils.ts";

const { setup } = useThreadWorld();

const messageCount = async (s: Awaited<ReturnType<typeof setup>>["s"], threadId: string) =>
  (await s.db.selectFrom("chat_messages").select("id").where("session_id", "=", threadId).execute())
    .length;

describe("sending to a thread only while it is in some status", () => {
  test("sends to a thread that is in one of them, like any message", async () => {
    const { s, project } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Idle", prompt: "look around" });
    expect(thread.status).toBe("idle");

    const sent = await s.services.threads.send(thread.id, "more", undefined, {
      onlyIn: ["idle", "ready-for-review"],
    });

    expect(sent.success).toBe(true);
    await s.settle();
    expect(await messageCount(s, thread.id)).toBe(4);
  });

  test("refuses a thread that is not, as busy, and stores nothing", async () => {
    const { s, project } = await setup();
    const thread = await spawnAndSettle(s, project.id, { title: "Idle", prompt: "look around" });
    await s.services.threads.send(thread.id, "keep going [fake: startup=1000]");
    const before = await messageCount(s, thread.id);

    const refused = await s.services.threads.send(thread.id, "more", undefined, {
      onlyIn: ["idle", "ready-for-review"],
    });

    expect(refused).toEqual({ success: false, error: { code: "THREAD_BUSY" } });
    expect(await messageCount(s, thread.id)).toBe(before);
    await s.settle();
  });

  test("does not bring back the worktree of a resolved thread it refuses", async () => {
    const { s, project } = await setup({ repos: 1 });
    const thread = await spawnAndSettle(s, project.id, { title: "Done", prompt: "look around" });
    const resolved = await s.services.threads.resolve(thread.id);
    expect(resolved.success && resolved.thread.status).toBe("resolved");
    const worktree = aopPaths.worktree(thread.repoId ?? "", thread.id);
    expect(existsSync(worktree)).toBe(false);

    const refused = await s.services.threads.send(thread.id, "more", undefined, {
      onlyIn: ["idle", "ready-for-review"],
    });

    expect(refused).toEqual({ success: false, error: { code: "THREAD_BUSY" } });
    expect(existsSync(worktree)).toBe(false);
    expect((await s.services.threads.get(thread.id)).success).toBe(true);
    // Without the condition it is a reopen, as it always was.
    const reopened = await s.services.threads.send(thread.id, "more");
    expect(reopened.success && reopened.thread.status).toBe("working");
    await s.settle();
    expect(existsSync(worktree)).toBe(true);
  });
});
