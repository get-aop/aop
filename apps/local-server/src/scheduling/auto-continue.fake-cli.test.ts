import { describe, expect, test } from "bun:test";
import type { ProjectStack } from "../project/test-utils.ts";
import { useThreadWorld } from "../thread/test-utils.ts";
import { spawnThread, threadOf, untilStatus } from "./test-utils.ts";

// The project's auto-continue setting against the real chat engine, database and the fake CLI,
// whose `[fake: ratelimit=<seconds>]` turn ends the way Claude Code ends one on a usage limit.
// The reset is epoch seconds, so a wait of two seconds is two to three.

const { setup } = useThreadWorld();

const runStatuses = async (s: ProjectStack, sessionId: string): Promise<string[]> =>
  (
    await s.db
      .selectFrom("chat_runs")
      .select("status")
      .where("session_id", "=", sessionId)
      .orderBy("created_at")
      .orderBy("id")
      .execute()
  ).map((run) => run.status);

/** Waits until the thread's reset, and the margin a resume timer adds to it, have both passed. */
const pastTheReset = async (s: ProjectStack, threadId: string): Promise<void> => {
  const held = await threadOf(s, threadId);
  if (held.status !== "rate-limited") throw new Error(`thread is ${held.status}`);
  await Bun.sleep(Math.max(0, Date.parse(held.resumesAt) - Date.now()) + 1_500);
  await s.settle();
};

const setAutoContinue = (s: ProjectStack, projectId: string, autoContinue: boolean) =>
  s.api<{ project: { autoContinue: boolean } }>("PATCH", `/api/projects/${projectId}`, {
    autoContinue,
  });

describe("auto-continue off", () => {
  test("a rate-limited thread stays stopped past the reset until the person resumes it", async () => {
    const { s, project } = await setup({ settings: { autoContinue: false } });

    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=2]");
    const held = await untilStatus(s, thread.id, "rate-limited");
    expect(held.liveStatusLine).toMatch(
      /^Paused: You've hit your session limit · resets .*\. The limit resets at .*; auto-continue is off, so resume it when you are ready\.$/,
    );

    await pastTheReset(s, thread.id);

    expect((await threadOf(s, thread.id)).status).toBe("rate-limited");
    expect(await runStatuses(s, thread.id)).toEqual(["failed"]);
    expect((await s.ctx.chatSessionRepository.getById(thread.id))?.resumes_at).not.toBeNull();

    const resumed = await s.api("POST", `/api/threads/${thread.id}/resume`);
    expect(resumed.status).toBe(200);
    await untilStatus(s, thread.id, "idle");
    await s.settle();
    expect(await runStatuses(s, thread.id)).toEqual(["failed", "completed"]);
  }, 30_000);

  test("turning it on resumes a thread whose reset already passed", async () => {
    const { s, project } = await setup({ settings: { autoContinue: false } });
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=1]");
    await untilStatus(s, thread.id, "rate-limited");
    await pastTheReset(s, thread.id);
    expect((await threadOf(s, thread.id)).status).toBe("rate-limited");

    const patched = await setAutoContinue(s, project.id, true);

    expect(patched.status).toBe(200);
    expect(patched.body.project.autoContinue).toBe(true);
    await untilStatus(s, thread.id, "idle");
    await s.settle();
    expect(await runStatuses(s, thread.id)).toEqual(["failed", "completed"]);
  }, 30_000);
});

describe("auto-continue on", () => {
  test("a thread resumes by itself at the reset, even when it was turned on during the wait", async () => {
    const { s, project } = await setup({ settings: { autoContinue: false } });
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=2]");
    await untilStatus(s, thread.id, "rate-limited");
    expect((await setAutoContinue(s, project.id, true)).status).toBe(200);

    await untilStatus(s, thread.id, "idle");
    await s.settle();

    expect(await runStatuses(s, thread.id)).toEqual(["failed", "completed"]);
  }, 30_000);

  test("turning it off during the wait keeps the thread waiting at the reset", async () => {
    const { s, project } = await setup();
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=2]");
    const held = await untilStatus(s, thread.id, "rate-limited");
    expect(held.liveStatusLine).toMatch(/Resuming automatically at /);
    expect((await setAutoContinue(s, project.id, false)).status).toBe(200);

    await pastTheReset(s, thread.id);

    expect((await threadOf(s, thread.id)).status).toBe("rate-limited");
    expect(await runStatuses(s, thread.id)).toEqual(["failed"]);
  }, 30_000);
});
