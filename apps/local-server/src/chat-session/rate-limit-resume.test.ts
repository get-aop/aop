import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import type { RateLimitHit } from "../scheduling/rate-limit.ts";
import { pausedReply, RESUME_PROMPT, resumeRateLimited } from "./rate-limit-resume.ts";
import { cancelAllResumeTimers } from "./resume-timers.ts";

const HIT: RateLimitHit = {
  message: "You've hit your session limit · resets 3:45pm",
  resumesAt: new Date(2026, 8, 30, 15, 45, 1).toISOString(),
  resetKnown: true,
};

describe("pausedReply", () => {
  test("a project's session waits out the limit and says so", () => {
    const paused = pausedReply({ project_id: "p1" }, `Runtime error: ${HIT.message}`, HIT);

    expect(paused.rateLimit).toBe(HIT);
    expect(paused.text).toMatch(
      /^Paused: You've hit your session limit · resets 3:45pm\. Resuming/,
    );
  });

  test("a chat outside any project just fails with what the CLI said", () => {
    const paused = pausedReply({ project_id: null }, `Runtime error: ${HIT.message}`, HIT);

    expect(paused).toEqual({ text: `Runtime error: ${HIT.message}` });
  });

  test("a run no limit refused is left as it is", () => {
    expect(pausedReply({ project_id: "p1" }, "All done.", undefined)).toEqual({
      text: "All done.",
    });
  });
});

describe("resumeRateLimited", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  const drained: string[] = [];
  const drain = async (sessionId: string): Promise<void> => {
    drained.push(sessionId);
  };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    drained.length = 0;
    await insertProjectRow(db, "p1");
  });

  afterEach(async () => {
    cancelAllResumeTimers();
    await db.destroy();
  });

  const queuedMessages = (sessionId: string) =>
    db
      .selectFrom("chat_messages")
      .select(["content", "role", "disposition", "origin_json"])
      .where("session_id", "=", sessionId)
      .execute();

  test("does nothing to a session that is not waiting", async () => {
    await insertProjectSession(db, { id: "t1", projectId: "p1", kind: "thread" });

    expect(await resumeRateLimited(ctx, "t1", drain)).toBe(false);
    expect(await resumeRateLimited(ctx, "missing", drain)).toBe(false);

    expect(await queuedMessages("t1")).toEqual([]);
    expect(drained).toEqual([]);
  });

  test("ends a thread's wait, queues the nudge the thread will be given, and starts its turn", async () => {
    await insertProjectSession(
      db,
      { id: "t1", projectId: "p1", kind: "thread" },
      { state: "rate-limited", resumes_at: HIT.resumesAt },
    );

    expect(await resumeRateLimited(ctx, "t1", drain)).toBe(true);

    const row = await db
      .selectFrom("chat_sessions")
      .select(["state", "resumes_at"])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: "working", resumes_at: null });
    expect(await queuedMessages("t1")).toEqual([
      {
        role: "user",
        content: RESUME_PROMPT,
        disposition: "queued",
        origin_json: '{"type":"rate-limit-resume"}',
      },
    ]);
    expect(drained).toEqual(["t1"]);
    expect(await resumeRateLimited(ctx, "t1", drain)).toBe(false);
    expect(drained).toEqual(["t1"]);
  });

  test("a coordinator's wait ends too, and a message already waiting for it is the nudge", async () => {
    await insertProjectSession(
      db,
      { id: "c1", projectId: "p1", kind: "coordinator" },
      { resumes_at: HIT.resumesAt },
    );
    await db
      .insertInto("chat_messages")
      .values({ id: "report", session_id: "c1", role: "user", content: "a thread finished" })
      .execute();

    expect(await resumeRateLimited(ctx, "c1", drain)).toBe(true);

    expect((await queuedMessages("c1")).map((message) => message.content)).toEqual([
      "a thread finished",
    ]);
    const row = await db.selectFrom("chat_sessions").select("resumes_at").executeTakeFirstOrThrow();
    expect(row.resumes_at).toBeNull();
  });
});
