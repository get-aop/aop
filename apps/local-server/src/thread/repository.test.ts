import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PullRequestRef } from "@aop/common";
import type { Kysely } from "kysely";
import { READ_ONLY_ACCESS } from "../chat-session/run-profile.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { createThreadRepository, type ThreadRepository } from "./repository.ts";

const CREATED = "2026-09-30T09:00:00.000Z";
const T1 = new Date("2026-09-30T11:00:00.000Z");
const question = {
  question: "Ship it?",
  options: [
    { label: "Yes", recommended: true },
    { label: "No", recommended: false },
  ],
};
const pullRequest: PullRequestRef = {
  number: 7,
  url: "https://github.com/o/r/pull/7",
  state: "open",
};

describe("thread repository", () => {
  let db: Kysely<Database>;
  let threads: ThreadRepository;

  beforeEach(async () => {
    db = await createTestDb();
    threads = createThreadRepository(db, () => T1);
    await insertProjectRow(db, "p1");
    await insertProjectRow(db, "p2");
  });

  afterEach(async () => {
    await db.destroy();
  });

  const addThread = (id: string, projectId = "p1", columns = {}) =>
    insertProjectSession(db, { id, projectId, kind: "thread" }, columns);

  const addAssistantReplies = async (sessionId: string, replies: number) => {
    await db
      .insertInto("chat_messages")
      .values([
        { id: `${sessionId}-user`, session_id: sessionId, role: "user", content: "go" },
        ...Array.from({ length: replies }, (_, index) => ({
          id: `${sessionId}-reply-${index}`,
          session_id: sessionId,
          role: "assistant" as const,
          content: "done",
        })),
      ])
      .execute();
  };

  test("reads a new thread as the wire shape", async () => {
    await addThread("t1");
    await addAssistantReplies("t1", 2);

    expect(await threads.getById("t1")).toEqual({
      id: "t1",
      projectId: "p1",
      title: "t1",
      runtime: { provider: "claude-code", model: "claude-opus-4-8", effort: "medium" },
      target: { kind: "host" },
      repoId: null,
      branch: null,
      steps: [],
      liveStatusLine: null,
      artifacts: [],
      repliesCount: 2,
      unread: false,
      lastActivityAt: CREATED,
      createdAt: CREATED,
      status: "working",
    });
  });

  test("never returns a coordinator or an unknown session as a thread", async () => {
    await insertProjectSession(db, { id: "coordinator-1", projectId: "p1", kind: "coordinator" });
    await addThread("t1");

    expect(await threads.getById("coordinator-1")).toBeNull();
    expect(await threads.getById("missing")).toBeNull();
    expect((await threads.listByProject("p1")).map((thread) => thread.id)).toEqual(["t1"]);
  });

  test("lists a project's threads, most recent activity first", async () => {
    await addThread("t-old", "p1", { last_activity_at: "2026-09-30T09:00:00.000Z" });
    await addThread("t-new", "p1", { last_activity_at: "2026-09-30T10:00:00.000Z" });
    await addThread("t-other", "p2");

    expect((await threads.listByProject("p1")).map((thread) => thread.id)).toEqual([
      "t-new",
      "t-old",
    ]);
    expect((await threads.listByProject("p2")).map((thread) => thread.id)).toEqual(["t-other"]);
  });

  test("moves a thread through waiting, working and resolved, keeping each state's own field", async () => {
    await addThread("t1");

    const waiting = await threads.update("t1", {
      status: { status: "waiting-on-you", blockedQuestion: question },
    });
    expect(waiting).toMatchObject({ status: "waiting-on-you", blockedQuestion: question });

    const answered = await threads.update("t1", { status: { status: "working" } });
    expect(answered?.status).toBe("working");
    expect(answered).not.toHaveProperty("blockedQuestion");

    const resolved = await threads.update("t1", {
      status: { status: "resolved", resolvedAt: "2026-09-30T12:00:00.000Z" },
    });
    expect(resolved).toMatchObject({ status: "resolved", resolvedAt: "2026-09-30T12:00:00.000Z" });

    const reopened = await threads.update("t1", { status: { status: "idle" } });
    expect(reopened?.status).toBe("idle");
    expect(reopened).not.toHaveProperty("resolvedAt");
  });

  test("holds a thread in the queue, or on a rate limit with the time it resumes, and drops that time on leaving", async () => {
    await addThread("t1");

    const queued = await threads.update("t1", { status: { status: "queued" } });
    expect(queued?.status).toBe("queued");
    expect(queued).not.toHaveProperty("resumesAt");

    const limited = await threads.update("t1", {
      status: { status: "rate-limited", resumesAt: "2026-09-30T16:00:00.000Z" },
    });
    expect(limited).toMatchObject({
      status: "rate-limited",
      resumesAt: "2026-09-30T16:00:00.000Z",
    });
    expect(
      (await db.selectFrom("chat_sessions").select("resumes_at").executeTakeFirst())?.resumes_at,
    ).toBe("2026-09-30T16:00:00.000Z");

    const resumed = await threads.update("t1", { status: { status: "working" } });
    expect(resumed?.status).toBe("working");
    expect(resumed).not.toHaveProperty("resumesAt");
    expect(
      (await db.selectFrom("chat_sessions").select("resumes_at").executeTakeFirst())?.resumes_at,
    ).toBeNull();
  });

  test("does not touch the resume time of a coordinator waiting on a rate limit", async () => {
    await insertProjectSession(
      db,
      { id: "c1", projectId: "p1", kind: "coordinator" },
      { resumes_at: "2026-09-30T16:00:00.000Z" },
    );

    expect(await threads.update("c1", { status: { status: "idle" } })).toBeNull();

    const row = await db.selectFrom("chat_sessions").select("resumes_at").executeTakeFirst();
    expect(row?.resumes_at).toBe("2026-09-30T16:00:00.000Z");
  });

  test("a landing thread needs its pull request in the same update", async () => {
    await addThread("t1");

    await expect(threads.update("t1", { status: { status: "landing" } })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    expect((await threads.getById("t1"))?.status).toBe("working");

    const landing = await threads.update("t1", { status: { status: "landing" }, pullRequest });
    expect(landing).toMatchObject({
      status: "landing",
      artifacts: [{ type: "pr", ...pullRequest }],
    });
  });

  test("sets and clears the pull request", async () => {
    await addThread("t1");

    expect((await threads.update("t1", { pullRequest }))?.artifacts).toEqual([
      { type: "pr", ...pullRequest },
    ]);
    expect(
      (await threads.update("t1", { pullRequest: { ...pullRequest, state: "merged" } }))?.artifacts,
    ).toEqual([{ type: "pr", ...pullRequest, state: "merged" }]);
    expect((await threads.update("t1", { pullRequest: null }))?.artifacts).toEqual([]);
  });

  test("keeps the checks summary on the pull request artifact, and it follows the pull request", async () => {
    await addThread("t1");
    const checks = { state: "failure", successful: 2, failing: 1, pending: 0 } as const;

    const opened = await threads.update("t1", { pullRequest });
    expect(opened?.artifacts).toEqual([{ type: "pr", ...pullRequest }]);

    const read = await threads.update("t1", { checks });
    expect(read?.artifacts).toEqual([{ type: "pr", ...pullRequest, checks }]);
    // The state of the pull request changes without a stale summary put back or dropped.
    const merged = await threads.update("t1", { pullRequest: { ...pullRequest, state: "merged" } });
    expect(merged?.artifacts).toEqual([{ type: "pr", ...pullRequest, state: "merged", checks }]);
    expect((await threads.update("t1", { checks: null }))?.artifacts).toEqual([
      { type: "pr", ...pullRequest, state: "merged" },
    ]);
    await threads.update("t1", { checks });
    expect((await threads.update("t1", { pullRequest: null }))?.artifacts).toEqual([]);
    expect(
      (await db.selectFrom("chat_sessions").select("pr_checks_json").executeTakeFirst())
        ?.pr_checks_json,
    ).toBeNull();
  });

  test("updates progress, branch, target, read state and activity, and only those it is given", async () => {
    await addThread("t1");
    const steps = [
      { label: "Reproduce", state: "done" },
      { label: "Fix", state: "active" },
    ] as const;

    const updated = await threads.update("t1", {
      steps: [...steps],
      liveStatusLine: "Bisecting · 7 commits left",
      branch: "aop/fix-checkout",
      unread: true,
      lastActivityAt: "2026-09-30T10:30:00.000Z",
    });

    expect(updated).toMatchObject({
      steps,
      liveStatusLine: "Bisecting · 7 commits left",
      branch: "aop/fix-checkout",
      unread: true,
      lastActivityAt: "2026-09-30T10:30:00.000Z",
      target: { kind: "host" },
      status: "working",
    });

    const cleared = await threads.update("t1", { liveStatusLine: null, unread: false });
    expect(cleared).toMatchObject({
      liveStatusLine: null,
      unread: false,
      branch: "aop/fix-checkout",
    });
  });

  test("an update stamps the session's updated_at", async () => {
    await addThread("t1");

    await threads.update("t1", { unread: true });

    const row = await db
      .selectFrom("chat_sessions")
      .select("updated_at")
      .where("id", "=", "t1")
      .executeTakeFirstOrThrow();
    expect(row.updated_at).toBe(T1.toISOString());
  });

  test("an update aimed at a coordinator or an unknown id changes nothing", async () => {
    await insertProjectSession(db, { id: "coordinator-1", projectId: "p1", kind: "coordinator" });

    expect(await threads.update("coordinator-1", { unread: true })).toBeNull();
    expect(await threads.update("missing", { unread: true })).toBeNull();

    const row = await db
      .selectFrom("chat_sessions")
      .select(["unread", "updated_at"])
      .where("id", "=", "coordinator-1")
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ unread: 0, updated_at: CREATED });
  });

  test("a project's new thread access reaches its threads, but a thread started read-only stays read-only", async () => {
    await addThread("t1", "p1", { runtime_access_mode: "full-access" });
    await addThread("survey", "p1", { runtime_access_mode: READ_ONLY_ACCESS });
    await addThread("elsewhere", "p2", { runtime_access_mode: "full-access" });

    await threads.setAccessForProject("p1", "auto-accept-edits");
    await threads.setAccessForProject("p1", "full-access");
    await threads.setAccessForProject("p1", "auto-accept-edits");

    const rows = await db
      .selectFrom("chat_sessions")
      .select(["id", "runtime_access_mode"])
      .orderBy("id")
      .execute();
    expect(rows).toEqual([
      { id: "elsewhere", runtime_access_mode: "full-access" },
      { id: "survey", runtime_access_mode: READ_ONLY_ACCESS },
      { id: "t1", runtime_access_mode: "auto-accept-edits" },
    ]);
  });

  test("a stored checklist that no longer matches the schema fails loudly when read", async () => {
    await addThread("t1", "p1", { steps_json: '[{"label":"","state":"unknown"}]' });

    await expect(threads.getById("t1")).rejects.toThrow();
  });
});
