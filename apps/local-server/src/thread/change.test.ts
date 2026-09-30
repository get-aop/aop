import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { changeThreadFrom } from "./change.ts";

describe("changeThreadFrom", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await insertProjectRow(db, "p1");
    await insertProjectSession(db, { id: "t1", projectId: "p1", kind: "thread" });
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("applies the status when the thread is in one of the given statuses, and says what it found", async () => {
    await ctx.threadRepository.update("t1", { status: { status: "idle" } });

    const changed = await changeThreadFrom(ctx, "t1", ["idle"], {
      status: { status: "ready-for-review" },
    });

    expect(changed).toMatchObject({
      applied: true,
      previous: { status: "idle" },
      thread: { status: "ready-for-review" },
    });
  });

  test("leaves the status alone when the thread has moved on, and still applies the rest", async () => {
    await ctx.threadRepository.update("t1", { status: { status: "working" } });

    const changed = await changeThreadFrom(ctx, "t1", ["idle"], {
      liveStatusLine: "Opened",
      status: { status: "ready-for-review" },
    });

    expect(changed).toMatchObject({
      applied: false,
      previous: { status: "working" },
      thread: { status: "working", liveStatusLine: "Opened" },
    });
  });

  test("never takes a thread out of the run queue or a rate-limit wait", async () => {
    await ctx.threadRepository.update("t1", { status: { status: "queued" } });
    const queued = await changeThreadFrom(ctx, "t1", ["idle"], {
      status: { status: "ready-for-review" },
    });
    await ctx.threadRepository.update("t1", {
      status: { status: "rate-limited", resumesAt: "2026-09-30T16:00:00.000Z" },
    });
    const limited = await changeThreadFrom(ctx, "t1", ["idle", "landing"], {
      status: { status: "idle" },
    });

    expect(queued).toMatchObject({ applied: false, thread: { status: "queued" } });
    expect(limited).toMatchObject({
      applied: false,
      thread: { status: "rate-limited", resumesAt: "2026-09-30T16:00:00.000Z" },
    });
  });

  test("a thread that is not there changes nothing and appends no entry", async () => {
    const changed = await changeThreadFrom(ctx, "nope", ["idle"], { liveStatusLine: "x" });

    expect(changed).toEqual({ previous: null, thread: null, applied: false });
    expect(await db.selectFrom("event_log").select("id").execute()).toEqual([]);
  });
});
