import { describe, expect, test } from "bun:test";
import { SettingKey } from "../settings/types.ts";
import { useRoutineWorld } from "./test-utils.ts";

const { setup } = useRoutineWorld();

const MORNING = {
  name: "Morning digest",
  prompt: "Summarize new issues and pull requests",
  schedule: { kind: "weekdays", time: "09:00" },
};

describe("routine routes", () => {
  test("create, list, edit, run history and delete", async () => {
    const { s, project } = await setup();
    const base = `/api/projects/${project.id}/routines`;

    const created = await s.api<{ routine: { id: string; nextRunAt: string } }>(
      "POST",
      base,
      MORNING,
    );
    expect(created.status).toBe(201);
    expect(created.body.routine).toMatchObject({
      name: "Morning digest",
      target: "thread",
      enabled: true,
      catchUp: "skip",
      createdBy: "person",
      // 2026-06-01 is a Monday; the clock reads 08:00 UTC.
      nextRunAt: "2026-06-01T09:00:00.000Z",
      lastRun: null,
    });
    const id = created.body.routine.id;

    const listed = await s.api<{ routines: unknown[]; timeZone: string; limits: unknown }>(
      "GET",
      base,
    );
    expect(listed.body).toEqual({
      routines: [expect.objectContaining({ id })],
      timeZone: "UTC",
      limits: { minIntervalMinutes: 15, maxActive: 10 },
    });

    const edited = await s.api("PATCH", `${base}/${id}`, {
      schedule: { kind: "weekly", days: [5], time: "17:00" },
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ routine: { nextRunAt: "2026-06-05T17:00:00.000Z" } });

    expect((await s.api("GET", `${base}/${id}/runs`)).body).toEqual({ runs: [] });
    expect((await s.api("DELETE", `${base}/${id}`)).status).toBe(204);
    expect((await s.api("GET", `${base}/${id}`)).status).toBe(404);
    expect((await s.api("GET", base)).body).toMatchObject({ routines: [] });
  });

  test("refuses bad input with a sentence naming the field", async () => {
    const { s, project } = await setup();
    const base = `/api/projects/${project.id}/routines`;

    const noName = await s.api("POST", base, { ...MORNING, name: " " });
    expect(noName).toMatchObject({ status: 400, body: { error: "Name is required." } });
    const badCron = await s.api("POST", base, {
      ...MORNING,
      schedule: { kind: "cron", expression: "0 25 * * *" },
    });
    expect(badCron).toMatchObject({
      status: 400,
      body: { error: "Hour: 25 is outside 0-23" },
    });
    const emptyPatch = await s.api("PATCH", `${base}/rtn_missing`, {});
    expect(emptyPatch.status).toBe(400);
    expect((await s.api("PATCH", `${base}/rtn_missing`, { name: "x" })).status).toBe(404);
  });

  test("refuses a schedule more often than every 15 minutes until the owner lowers the cap", async () => {
    const { s, project } = await setup();
    const base = `/api/projects/${project.id}/routines`;
    const often = { ...MORNING, schedule: { kind: "cron", expression: "*/5 * * * *" } };

    const refused = await s.api("POST", base, often);
    expect(refused).toMatchObject({
      status: 400,
      body: { code: "ROUTINE_TOO_FREQUENT" },
    });
    expect((refused.body as { error: string }).error).toContain("every 5 minutes");

    const preview = await s.api("POST", `${base}/preview`, { schedule: often.schedule });
    expect(preview.body).toMatchObject({
      description: "Custom: */5 * * * *",
      nextRuns: [
        "2026-06-01T08:05:00.000Z",
        "2026-06-01T08:10:00.000Z",
        "2026-06-01T08:15:00.000Z",
      ],
      timeZone: "UTC",
    });
    expect((preview.body as { problem: string }).problem).toContain("at most every 15 minutes");

    await s.ctx.settingsRepository.set(SettingKey.ROUTINE_MIN_INTERVAL, "5");
    expect((await s.api("POST", base, often)).status).toBe(201);
  });

  test("caps the routines a project has turned on; a paused one does not count", async () => {
    const { s, project } = await setup();
    const base = `/api/projects/${project.id}/routines`;
    await s.ctx.settingsRepository.set(SettingKey.ROUTINE_MAX_ACTIVE, "2");

    await s.api("POST", base, MORNING);
    const second = await s.api<{ routine: { id: string } }>("POST", base, MORNING);
    const third = await s.api("POST", base, MORNING);
    expect(third).toMatchObject({ status: 409, body: { code: "ROUTINE_LIMIT" } });

    // Made paused, it is allowed; turned on, it is refused until another is paused.
    const paused = await s.api<{ routine: { id: string } }>("POST", base, {
      ...MORNING,
      enabled: false,
    });
    expect(paused.status).toBe(201);
    const turnOn = await s.api("PATCH", `${base}/${paused.body.routine.id}`, { enabled: true });
    expect(turnOn).toMatchObject({ status: 409, body: { code: "ROUTINE_LIMIT" } });
    await s.api("PATCH", `${base}/${second.body.routine.id}`, { enabled: false });
    expect(
      (await s.api("PATCH", `${base}/${paused.body.routine.id}`, { enabled: true })).status,
    ).toBe(200);
  });

  test("a thread routine in a project with several repositories names one of them", async () => {
    const { s, project } = await setup({ repos: 2 });
    const base = `/api/projects/${project.id}/routines`;

    expect(await s.api("POST", base, MORNING)).toMatchObject({
      status: 400,
      body: { code: "REPO_REQUIRED" },
    });
    expect(await s.api("POST", base, { ...MORNING, repoId: "repo_elsewhere" })).toMatchObject({
      status: 400,
      body: { code: "REPO_NOT_IN_PROJECT" },
    });
    expect((await s.api("POST", base, { ...MORNING, repoId: s.repos[1]?.id })).status).toBe(201);
    // A message to the coordinator needs none.
    expect((await s.api("POST", base, { ...MORNING, target: "coordinator" })).status).toBe(201);
  });

  test("Run now answers with the run and the thread it started", async () => {
    const { s, project } = await setup();
    const base = `/api/projects/${project.id}/routines`;
    const created = await s.api<{ routine: { id: string } }>("POST", base, MORNING);

    const ran = await s.api<{ run: { threadId: string; trigger: string } }>(
      "POST",
      `${base}/${created.body.routine.id}/run`,
    );
    expect(ran.status).toBe(201);
    expect(ran.body.run.trigger).toBe("manual");
    expect(await s.ctx.threadRepository.getById(ran.body.run.threadId)).not.toBeNull();
    await s.settle();
  });

  test("changes reach the project's event log", async () => {
    const { s, project } = await setup();
    const base = `/api/projects/${project.id}/routines`;
    const created = await s.api<{ routine: { id: string } }>("POST", base, MORNING);
    await s.api("DELETE", `${base}/${created.body.routine.id}`);

    const types = (
      await s.db
        .selectFrom("event_log")
        .select("type")
        .where("project_id", "=", project.id)
        .where("type", "like", "routine.%")
        .orderBy("id")
        .execute()
    ).map((row) => row.type);
    expect(types).toEqual(["routine.upserted", "routine.removed"]);
  });
});
