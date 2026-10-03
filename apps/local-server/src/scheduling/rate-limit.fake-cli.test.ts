import { describe, expect, test } from "bun:test";
import type { Message } from "@aop/common";
import { RESUME_PROMPT } from "../chat-session/rate-limit-resume.ts";
import { cancelAllResumeTimers } from "../chat-session/resume-timers.ts";
import { createCommandContext } from "../context.ts";
import { createProjectServices } from "../project/services.ts";
import { eventually, fakeOnlyClaude, type ProjectStack } from "../project/test-utils.ts";
import { coordinatorInbox, useThreadWorld } from "../thread/test-utils.ts";
import { spawnThread, threadEvents, threadOf, untilStarted, untilStatus } from "./test-utils.ts";

// Usage limits against the real chat engine, database, event log and the fake CLI, whose
// `[fake: ratelimit=<seconds>]` turn ends the way Claude Code ends one when a plan window is used
// up. The reset the fake reports is epoch seconds, so a wait of two seconds is two to three.

const { setup } = useThreadWorld();

const runsOf = (s: ProjectStack, sessionId: string) =>
  s.db
    .selectFrom("chat_runs")
    .select(["status", "failure_kind", "error_message"])
    .where("session_id", "=", sessionId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();

const transcript = async (s: ProjectStack, threadId: string): Promise<Message[]> => {
  const listed = await s.services.threads.listMessages(threadId);
  if (!listed.success) throw new Error("no transcript");
  return listed.messages;
};

const secondsUntil = (iso: string): number => (Date.parse(iso) - Date.now()) / 1000;

/**
 * A thread shows as held before the turn that held it has armed its resume timer, which it does
 * as the last thing it does. A test that cancels timers to imitate a restart has to wait for that,
 * or the late timer, armed for the old time, replaces the one the restart armed.
 */
const settleTheHold = (s: ProjectStack): Promise<void> => s.settle();

describe("a run the CLI refuses on a usage limit", () => {
  test("puts the thread on hold instead of failing it, and it resumes by itself at the reset", async () => {
    const { s, project } = await setup();

    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=2]");
    const held = await untilStatus(s, thread.id, "rate-limited");

    expect(held).toMatchObject({ status: "rate-limited", unread: true });
    expect(held.status === "rate-limited" && secondsUntil(held.resumesAt)).toBeGreaterThan(0);
    expect(held.status === "rate-limited" && secondsUntil(held.resumesAt)).toBeLessThan(5);
    expect(held.liveStatusLine).toMatch(
      /^Paused: You've hit your session limit · resets \d{1,2}:\d{2}(am|pm)\. Resuming automatically at /,
    );
    expect(await runsOf(s, thread.id)).toEqual([
      {
        status: "failed",
        failure_kind: "rate_limit",
        error_message: expect.stringContaining("Paused: You've hit your session limit"),
      },
    ]);
    // Not over, so not reported: the coordinator is not woken by a turn that will be retried.
    expect(await coordinatorInbox(s, project.id)).toEqual([]);

    await untilStatus(s, thread.id, "idle");
    await s.settle();

    // The turn that follows the wait picks the CLI's session up where the refused one left it.
    const [refused, resumed] = s.runs.filter((run) => run.env?.AOP_CHAT_SESSION_ID === thread.id);
    const [refusedRun] = await s.db
      .selectFrom("chat_runs")
      .select("runtime_session_id")
      .where("session_id", "=", thread.id)
      .orderBy("created_at")
      .execute();
    expect(refused?.resumeSessionId).toBeUndefined();
    expect(refusedRun?.runtime_session_id).toBeTruthy();
    expect(resumed?.resumeSessionId).toBe(refusedRun?.runtime_session_id ?? undefined);
    expect(resumed?.prompt).toContain(RESUME_PROMPT);
    expect((await runsOf(s, thread.id)).map((run) => run.status)).toEqual(["failed", "completed"]);
    expect(
      await threadEvents(s, project.id, thread.id).then((all) =>
        all.filter((status, i) => status !== all[i - 1]),
      ),
    ).toEqual(["working", "rate-limited", "working", "idle"]);
  }, 30_000);

  test("keeps the nudge out of the transcript: the reply that explains the wait is enough", async () => {
    const { s, project } = await setup();
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=1]");

    await untilStatus(s, thread.id, "idle");
    await s.settle();

    const messages = await transcript(s, thread.id);
    const texts = messages.map((message) =>
      message.role === "assistant" ? JSON.stringify(message.blocks) : message.role,
    );
    // The coordinator's brief, the reply that explains the wait, and the reply after it: the
    // nudge that made the third is stored, but it is no message of anyone's.
    expect(
      messages.map((message) => (message.role === "user" ? message.sender : message.role)),
    ).toEqual(["coordinator", "assistant", "assistant"]);
    expect(texts[1]).toContain("Paused: You've hit your session limit");
    expect(texts[2]).toContain("Fake reply for turn 2");
    const stored = await s.services.chat.get(thread.id);
    expect(stored.success && stored.session.messages.some((m) => m.content === RESUME_PROMPT)).toBe(
      true,
    );
  }, 30_000);

  test("can be resumed by hand before the reset, once", async () => {
    const { s, project } = await setup();
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=3600]");
    const held = await untilStatus(s, thread.id, "rate-limited");
    expect(held.status === "rate-limited" && secondsUntil(held.resumesAt)).toBeGreaterThan(3500);

    const resumed = await s.api<{ thread: { status: string } }>(
      "POST",
      `/api/threads/${thread.id}/resume`,
    );
    expect(resumed.status).toBe(200);
    await untilStatus(s, thread.id, "idle");
    await s.settle();
    const again = await s.api<{ code: string }>("POST", `/api/threads/${thread.id}/resume`);

    expect(again).toMatchObject({ status: 409, body: { code: "NOT_RATE_LIMITED" } });
    expect((await s.api("POST", "/api/threads/isess_missing/resume")).status).toBe(404);
    expect((await runsOf(s, thread.id)).map((run) => run.status)).toEqual(["failed", "completed"]);
    expect((await s.ctx.chatSessionRepository.getById(thread.id))?.resumes_at).toBeNull();
  }, 30_000);

  test("is resumed at once by a message to the thread, which is the person's own retry", async () => {
    const { s, project } = await setup();
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=3600]");
    await untilStatus(s, thread.id, "rate-limited");

    const sent = await s.services.threads.send(thread.id, "Carry on with the tests instead");
    expect(sent.success && sent.thread.status).toBe("working");
    await untilStatus(s, thread.id, "idle");
    await s.settle();

    const prompts = s.runs.map((run) => run.prompt);
    expect(prompts.at(-1)).toContain("Carry on with the tests instead");
    expect(prompts.join("")).not.toContain(RESUME_PROMPT);
    expect((await s.ctx.chatSessionRepository.getById(thread.id))?.resumes_at).toBeNull();
  }, 30_000);

  test("is ended by Stop: the thread goes idle and never resumes", async () => {
    const { s, project } = await setup();
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=3600]");
    await untilStatus(s, thread.id, "rate-limited");

    const stopped = await s.services.threads.stop(thread.id);

    expect(stopped.success && stopped.thread).toMatchObject({
      status: "idle",
      liveStatusLine: "Stopped",
    });
    expect(await s.services.chat.resumeRateLimited(thread.id)).toBe(false);
    expect(s.runs).toHaveLength(1);
  }, 30_000);
});

describe("a wait on a rate limit", () => {
  test("survives a restart: the timer is armed again from the stored time", async () => {
    const { s, project } = await setup();
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=3600]");
    await untilStatus(s, thread.id, "rate-limited");
    await settleTheHold(s);

    // The server stops, and comes back with the reset one second away.
    cancelAllResumeTimers();
    await s.db
      .updateTable("chat_sessions")
      .set({ resumes_at: new Date(Date.now() + 1000).toISOString() })
      .where("id", "=", thread.id)
      .execute();
    expect((await threadOf(s, thread.id)).status).toBe("rate-limited");
    createProjectServices(createCommandContext(s.db), {
      createProviderFn: () => fakeOnlyClaude,
      recoveryPollIntervalMs: 20,
    });

    await untilStatus(s, thread.id, "idle");
    expect((await runsOf(s, thread.id)).map((run) => run.status)).toEqual(["failed", "completed"]);
  }, 30_000);

  test("that came due while the server was down resumes as soon as it is back", async () => {
    const { s, project } = await setup();
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=3600]");
    await untilStatus(s, thread.id, "rate-limited");
    await settleTheHold(s);
    cancelAllResumeTimers();
    await s.db
      .updateTable("chat_sessions")
      .set({ resumes_at: new Date(Date.now() - 60_000).toISOString() })
      .where("id", "=", thread.id)
      .execute();

    createProjectServices(createCommandContext(s.db), {
      createProviderFn: () => fakeOnlyClaude,
      recoveryPollIntervalMs: 20,
    });

    await untilStatus(s, thread.id, "idle");
  }, 30_000);

  test("ends the same however many times it is resumed at once", async () => {
    const { s, project } = await setup();
    const thread = await spawnThread(s, project.id, "Fix it [fake: ratelimit=3600]");
    await untilStatus(s, thread.id, "rate-limited");

    const outcomes = await Promise.all([
      s.services.chat.resumeRateLimited(thread.id),
      s.services.chat.resumeRateLimited(thread.id),
      s.services.chat.resumeRateLimited(thread.id),
    ]);
    await untilStatus(s, thread.id, "idle");
    await s.settle();

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const nudges = await s.db
      .selectFrom("chat_messages")
      .select("id")
      .where("session_id", "=", thread.id)
      .where("content", "=", RESUME_PROMPT)
      .execute();
    expect(nudges).toHaveLength(1);
    expect(await s.services.chat.resumeRateLimited(thread.id)).toBe(false);
  }, 30_000);

  test("takes up a message that was already queued instead of writing another", async () => {
    const { s, project } = await setup();
    const thread = await spawnThread(s, project.id, "Fix it [fake: startup=600 ratelimit=3600]");
    // A message held for after the turn waits behind it, and the limit then holds both.
    await untilStarted(s, thread.id);
    await s.services.threads.send(thread.id, "Also update the docs", undefined, {
      midRunMode: "queue",
    });
    await untilStatus(s, thread.id, "rate-limited");

    await s.services.threads.resume(thread.id);
    await untilStatus(s, thread.id, "idle");
    await s.settle();

    expect(s.runs.map((run) => run.prompt).at(-1)).toContain("Also update the docs");
    const nudges = await s.db
      .selectFrom("chat_messages")
      .select("id")
      .where("content", "=", RESUME_PROMPT)
      .execute();
    expect(nudges).toEqual([]);
  }, 30_000);
});

describe("a coordinator refused on a limit", () => {
  test("holds its inbox until the reset, then handles the report that was waiting", async () => {
    const { s, project } = await setup();
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    if (!coordinator) throw new Error("the project has no coordinator");

    const sent = await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: "Hello [fake: ratelimit=3]",
    });
    expect(sent.status).toBe(201);
    await eventually(
      async () =>
        (await s.ctx.chatSessionRepository.getById(coordinator.id))?.resumes_at ?? undefined,
      "the coordinator to go on hold",
    );
    expect((await runsOf(s, coordinator.id)).map((run) => run.failure_kind)).toEqual([
      "rate_limit",
    ]);

    // A thread finishes meanwhile; its report waits instead of starting a run the limit would refuse.
    const thread = await spawnThread(s, project.id, "Quick job");
    await untilStatus(s, thread.id, "idle");
    await s.settle();
    expect(await runsOf(s, coordinator.id)).toHaveLength(1);
    expect(await coordinatorInbox(s, project.id)).toHaveLength(1);

    await eventually(
      async () => ((await runsOf(s, coordinator.id)).length === 2 ? true : undefined),
      "the coordinator to take up the report",
    );
    await s.settle();

    expect((await runsOf(s, coordinator.id)).map((run) => run.status)).toEqual([
      "failed",
      "completed",
    ]);
    expect((await s.ctx.chatSessionRepository.getById(coordinator.id))?.resumes_at).toBeNull();
    const nudges = await s.db
      .selectFrom("chat_messages")
      .select("id")
      .where("content", "=", RESUME_PROMPT)
      .execute();
    expect(nudges).toEqual([]);
  }, 30_000);
});
