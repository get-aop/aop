import { describe, expect, test } from "bun:test";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import { eventually } from "../project/test-utils.ts";
import { createRoutineRepository } from "./repository.ts";
import { processDue, useRoutineWorld } from "./test-utils.ts";

const { setup } = useRoutineWorld();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("a routine coming due", () => {
  test("starts a thread with its brief, linked from the run, and moves on to the next occurrence", async () => {
    const { s, project, clock, create, runs, routine } = await setup();
    const made = await create({ schedule: { kind: "daily", time: "09:00" } });
    expect(made.nextRunAt).toBe("2026-06-01T09:00:00.000Z");

    // Not due yet: nothing happens.
    await processDue(s);
    expect(await runs(made.id)).toEqual([]);

    clock.set("2026-06-01T09:00:20.000Z");
    await processDue(s);

    const [run] = await runs(made.id);
    expect(run).toMatchObject({
      occurrence: "2026-06-01T09:00:00.000Z",
      trigger: "schedule",
      messageId: null,
    });
    const threadId = run?.threadId ?? "";
    const thread = await s.ctx.threadRepository.getById(threadId);
    expect(thread?.projectId).toBe(project.id);
    expect(thread?.title).toStartWith("Morning digest · ");
    const [brief] = await s.ctx.chatSessionRepository.listMessages(threadId);
    expect(brief?.content).toContain("Summarize new issues");
    expect(brief?.content).toContain('started by the routine "Morning digest"');

    expect((await routine(made.id)).nextRunAt).toBe("2026-06-02T09:00:00.000Z");
    // The run's status follows its thread: working, then done when the fake's turn ends.
    await s.settle();
    await eventually(
      async () => ((await runs(made.id))[0]?.status === "ok" ? true : undefined),
      "the run to finish",
    );
    expect((await routine(made.id)).lastRun?.status).toBe("ok");
  });

  test("a coordinator routine sends its brief to the chat, shown as the routine's", async () => {
    const { s, project, clock, create, runs } = await setup();
    const made = await create({ target: "coordinator", prompt: "Write the weekly report" });

    clock.set("2026-06-01T09:00:00.000Z");
    await processDue(s);

    const [run] = await runs(made.id);
    expect(run?.threadId).toBeNull();
    expect(run?.messageId).toBeString();
    const listed = await s.services.projects.listMessages(project.id);
    const shown = listed.success ? listed.messages.find((m) => m.id === run?.messageId) : null;
    expect(shown).toMatchObject({
      role: "user",
      text: "Write the weekly report",
      routine: { id: made.id, name: "Morning digest" },
    });
    const stored = await s.db
      .selectFrom("chat_messages")
      .select(["content", "origin_json"])
      .where("id", "=", run?.messageId ?? "")
      .executeTakeFirstOrThrow();
    // The coordinator reads which routine sent it; the person reads only the brief.
    expect(stored.content).toStartWith('[Routine "Morning digest"');
    expect(parseMessageOrigin(stored.origin_json)?.type).toBe("routine");
    await s.settle();
    await eventually(
      async () => ((await runs(made.id))[0]?.status === "ok" ? true : undefined),
      "the coordinator turn to finish",
    );
  });

  test("a thread routine uses its own model and effort over the project's", async () => {
    const { s, clock, create, runs } = await setup();
    const made = await create({ model: "fake-model" });
    clock.set("2026-06-01T09:00:00.000Z");
    await processDue(s);
    const session = await s.ctx.chatSessionRepository.getById(
      (await runs(made.id))[0]?.threadId ?? "",
    );
    expect(session?.model).toBe("fake-model");
  });
});

describe("never firing an occurrence twice", () => {
  test("passes that overlap start one thread", async () => {
    const { s, clock, create, runs, threadCount } = await setup();
    const made = await create();
    clock.set("2026-06-01T09:00:00.000Z");

    await Promise.all([processDue(s), processDue(s), processDue(s)]);

    expect(await runs(made.id)).toHaveLength(1);
    expect(await threadCount()).toBe(1);
  });

  test("a restarted host does not fire the occurrence again", async () => {
    const { s, clock, create, runs, threadCount, secondHost } = await setup();
    const made = await create();
    clock.set("2026-06-01T09:00:30.000Z");
    await processDue(s);
    expect(await threadCount()).toBe(1);

    // A new process on the same database: its own runner and scheduler, nothing in memory.
    const restarted = secondHost();
    await restarted.routineScheduler.runPass();
    clock.advance(30_000);
    await restarted.routineScheduler.runPass();

    expect(await runs(made.id)).toHaveLength(1);
    expect(await threadCount()).toBe(1);
  });

  test("two host processes on one database start the occurrence once between them", async () => {
    const { s, clock, create, runs, threadCount, secondHost } = await setup();
    const made = await create();
    const other = secondHost();
    clock.set("2026-06-01T09:00:00.000Z");

    await Promise.all([processDue(s), other.routineScheduler.runPass(), processDue(s)]);

    expect(await runs(made.id)).toHaveLength(1);
    expect(await threadCount()).toBe(1);
  });

  test("a run a stopped host left half-started is failed at the next start, and not retried", async () => {
    const { s, clock, create, runs, secondHost } = await setup();
    const made = await create();
    const repo = createRoutineRepository(s.db);
    await repo.insertRun(
      {
        id: "rrun_crashed",
        routineId: made.id,
        occurrenceKey: "2026-06-01T09:00:00.000Z",
        occurrence: "2026-06-01T09:00:00.000Z",
        trigger: "schedule",
        state: "starting",
      },
      "2026-06-01T09:00:00.000Z",
    );
    await repo.update(
      made.id,
      { next_run_at: "2026-06-02T09:00:00.000Z" },
      "2026-06-01T09:00:00.000Z",
    );
    clock.set("2026-06-01T09:05:00.000Z");

    const restarted = secondHost();
    await restarted.routineScheduler.start();
    await restarted.routineScheduler.stop();

    expect(await runs(made.id)).toEqual([
      expect.objectContaining({
        id: "rrun_crashed",
        status: "failed",
        reason: "The host stopped before this run started its work",
      }),
    ]);
  });
});

describe("runs missed while the host was off", () => {
  test("skip (the default) records them as missed in one entry and starts nothing", async () => {
    const { s, clock, create, runs, routine, threadCount } = await setup();
    const made = await create({ schedule: { kind: "daily", time: "09:00" } });

    // The host comes back three days and an hour later.
    clock.set("2026-06-04T10:00:00.000Z");
    await processDue(s);

    expect(await runs(made.id)).toEqual([
      expect.objectContaining({
        status: "missed",
        occurrence: "2026-06-01T09:00:00.000Z",
        reason: "Missed 4 runs while the host was off",
        threadId: null,
      }),
    ]);
    expect(await threadCount()).toBe(0);
    expect((await routine(made.id)).nextRunAt).toBe("2026-06-05T09:00:00.000Z");
  });

  test("run-once starts one catch-up run, whatever the number missed", async () => {
    const { s, clock, create, runs, threadCount } = await setup();
    const made = await create({ catchUp: "run-once" });

    clock.set("2026-06-01T09:00:00.000Z");
    clock.advance(2 * DAY + HOUR);
    await processDue(s);
    await processDue(s);

    const listed = await runs(made.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      trigger: "catch-up",
      reason: "Ran once on start: Missed 3 runs while the host was off",
    });
    expect(listed[0]?.threadId).toBeString();
    expect(await threadCount()).toBe(1);
  });

  test("an occurrence reached a little late is not missed", async () => {
    const { s, clock, create, runs } = await setup();
    const made = await create();
    clock.set("2026-06-01T09:01:30.000Z");
    await processDue(s);
    expect((await runs(made.id))[0]?.trigger).toBe("schedule");
  });
});

describe("when a run does not start", () => {
  test("the previous run still working skips the occurrence and records it", async () => {
    const { s, project, clock, create, runs, threadCount } = await setup();
    const made = await create({ schedule: { kind: "hourly", every: 1, minute: 0 } });
    clock.set("2026-06-01T09:00:00.000Z");
    await processDue(s);
    const threadId = (await runs(made.id))[0]?.threadId ?? "";
    await s.settle();
    // The first run's thread is still at work when the next hour comes round.
    await s.db
      .updateTable("chat_sessions")
      .set({ state: "working" })
      .where("id", "=", threadId)
      .execute();

    clock.set("2026-06-01T10:00:00.000Z");
    await processDue(s);

    const [latest] = await runs(made.id);
    expect(latest).toMatchObject({
      status: "skipped",
      reason: "The previous run is still working",
      occurrence: "2026-06-01T10:00:00.000Z",
    });
    expect(await threadCount()).toBe(1);
    // "Run now" is refused for the same reason.
    const now = await s.services.routines.runNow(project.id, made.id);
    expect(now.success === false && now.error.code).toBe("ROUTINE_BUSY");
  });

  test("a paused project skips its routines; an archived one does not run them at all", async () => {
    const { s, project, clock, create, runs } = await setup();
    const made = await create();
    await s.services.projects.transition(project.id, "pause");
    clock.set("2026-06-01T09:00:00.000Z");
    await processDue(s);
    expect((await runs(made.id))[0]).toMatchObject({
      status: "skipped",
      reason: "The project is paused",
    });

    await s.services.projects.transition(project.id, "archive");
    clock.set("2026-06-02T09:00:00.000Z");
    await processDue(s);
    expect(await runs(made.id)).toHaveLength(1);
  });

  test("a usage limit defers the run to the reset when auto-continue is on, then runs it once", async () => {
    let limitUntil: string | null = "2026-06-01T11:00:00.000Z";
    const { s, clock, create, runs, routine, threadCount } = await setup({
      limitUntil: () => limitUntil,
    });
    const made = await create();
    clock.set("2026-06-01T09:00:00.000Z");
    await processDue(s);

    expect(await runs(made.id)).toEqual([
      expect.objectContaining({
        status: "deferred",
        occurrence: "2026-06-01T09:00:00.000Z",
        reason: "The Claude usage limit is reached; it runs when the limit resets",
      }),
    ]);
    expect((await routine(made.id)).nextRunAt).toBe("2026-06-01T11:00:00.000Z");
    // Looking again before the reset does nothing: it is not retried and failed each pass.
    clock.set("2026-06-01T10:00:00.000Z");
    await processDue(s);
    expect(await threadCount()).toBe(0);

    limitUntil = null;
    clock.set("2026-06-01T11:00:05.000Z");
    await processDue(s);

    const listed = await runs(made.id);
    // One entry: the run that waited, then ran.
    expect(listed).toHaveLength(1);
    expect(listed[0]?.threadId).toBeString();
    expect(listed[0]?.occurrence).toBe("2026-06-01T09:00:00.000Z");
    expect((await routine(made.id)).nextRunAt).toBe("2026-06-02T09:00:00.000Z");
  });

  test("a usage limit with auto-continue off skips the occurrence", async () => {
    const { s, clock, create, runs, routine } = await setup({
      limitUntil: () => "2026-06-01T11:00:00.000Z",
      settings: { autoContinue: false },
    });
    const made = await create();
    clock.set("2026-06-01T09:00:00.000Z");
    await processDue(s);
    expect((await runs(made.id))[0]).toMatchObject({
      status: "skipped",
      reason: "The Claude usage limit is reached and auto-continue is off",
    });
    expect((await routine(made.id)).nextRunAt).toBe("2026-06-02T09:00:00.000Z");
  });

  test("a paused routine does not run, and turned back on it counts from now", async () => {
    const { s, project, clock, create, runs, routine } = await setup();
    const made = await create();
    await s.services.routines.update(project.id, made.id, { enabled: false });
    expect((await routine(made.id)).nextRunAt).toBeNull();
    clock.set("2026-06-03T12:00:00.000Z");
    await processDue(s);
    expect(await runs(made.id)).toEqual([]);

    await s.services.routines.update(project.id, made.id, { enabled: true });
    expect((await routine(made.id)).nextRunAt).toBe("2026-06-04T09:00:00.000Z");
  });
});

describe("Run now", () => {
  test("starts a run outside the schedule and leaves the next scheduled run alone", async () => {
    const { s, project, create, runs, routine } = await setup();
    const made = await create();
    const ran = await s.services.routines.runNow(project.id, made.id);
    expect(ran.success && ran.run).toMatchObject({ trigger: "manual" });
    expect(ran.success && ran.run.threadId).toBeString();
    expect(await runs(made.id)).toHaveLength(1);
    expect((await routine(made.id)).nextRunAt).toBe("2026-06-01T09:00:00.000Z");
  });

  test("is refused in a paused project", async () => {
    const { s, project, create } = await setup();
    const made = await create();
    await s.services.projects.transition(project.id, "pause");
    const ran = await s.services.routines.runNow(project.id, made.id);
    expect(ran.success === false && ran.error.code).toBe("PROJECT_NOT_ACTIVE");
  });
});
