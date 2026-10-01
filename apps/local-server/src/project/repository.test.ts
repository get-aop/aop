import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ProjectSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { seedRepoRow } from "../chat-session/test-utils.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createProjectRepository, type ProjectRepository } from "./repository.ts";
import { insertProjectSession, projectSettings } from "./test-utils.ts";

const T0 = new Date("2026-09-30T09:00:00.000Z");
const T1 = new Date("2026-09-30T10:00:00.000Z");

describe("project repository", () => {
  let db: Kysely<Database>;
  let clock: Date;
  let projects: ProjectRepository;

  beforeEach(async () => {
    db = await createTestDb();
    clock = T0;
    projects = createProjectRepository(db, () => clock);
    await seedRepoRow(db, "r1");
    await seedRepoRow(db, "r2");
    await seedRepoRow(db, "r3");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates an active project that reads back exactly as it was created", async () => {
    const settings = projectSettings({ repoIds: ["r2", "r1"] });

    const created = await projects.create({ id: "p1", ...settings });

    expect(created).toEqual({
      id: "p1",
      ...settings,
      status: "active",
      reportedRuntime: {
        coordinator: { model: null, effort: null },
        thread: { model: null, effort: null },
      },
      createdAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    });
    expect(await projects.getById("p1")).toEqual(created);
    expect(ProjectSchema.safeParse(created).success).toBe(true);
  });

  test("stores what a role's run reported, field by field, without touching the settings or updatedAt", async () => {
    await projects.create({ id: "p1", ...projectSettings() });
    clock = T1;

    await projects.recordReportedRuntime("p1", "thread", { model: "claude-opus-5-5" });
    const after = await projects.recordReportedRuntime("p1", "thread", { effort: "medium" });

    expect(after?.reportedRuntime).toEqual({
      coordinator: { model: null, effort: null },
      thread: { model: "claude-opus-5-5", effort: "medium" },
    });
    expect(after?.updatedAt).toBe(T0.toISOString());
    expect(await projects.recordReportedRuntime("missing", "coordinator", { model: "x" })).toBe(
      null,
    );
  });

  test("stores whether threads may run any command, and a patch changes it", async () => {
    const created = await projects.create({
      id: "p1",
      ...projectSettings({ threadAccess: "full-access" }),
    });
    expect(created.threadAccess).toBe("full-access");

    const updated = await projects.update("p1", { threadAccess: "auto-accept-edits" });

    expect(updated?.threadAccess).toBe("auto-accept-edits");
    expect((await projects.getById("p1"))?.threadAccess).toBe("auto-accept-edits");
  });

  test("stores whether the watcher fixes pull requests by itself, and a patch changes it", async () => {
    const created = await projects.create({
      id: "p1",
      ...projectSettings({ autoFixPullRequests: false }),
    });
    expect(created.autoFixPullRequests).toBe(false);

    const updated = await projects.update("p1", { autoFixPullRequests: true });

    expect(updated?.autoFixPullRequests).toBe(true);
    expect((await projects.getById("p1"))?.autoFixPullRequests).toBe(true);
    // A patch that leaves it out leaves it as it is.
    expect((await projects.update("p1", { goal: "Ship" }))?.autoFixPullRequests).toBe(true);
  });

  test("keeps the order of the repos and returns null for an unknown project", async () => {
    await projects.create({ id: "p1", ...projectSettings({ repoIds: ["r3", "r1", "r2"] }) });

    expect((await projects.getById("p1"))?.repoIds).toEqual(["r3", "r1", "r2"]);
    expect(await projects.getById("missing")).toBeNull();
  });

  test("lists projects oldest first, each with its own repos", async () => {
    await projects.create({ id: "p-old", ...projectSettings({ repoIds: ["r1"] }) });
    clock = T1;
    await projects.create({ id: "p-new", ...projectSettings({ repoIds: ["r2", "r3"] }) });

    const listed = await projects.list();

    expect(listed.map((project) => [project.id, project.repoIds])).toEqual([
      ["p-old", ["r1"]],
      ["p-new", ["r2", "r3"]],
    ]);
  });

  test("an update changes only the settings in the patch and stamps updatedAt", async () => {
    const created = await projects.create({ id: "p1", ...projectSettings({ repoIds: ["r1"] }) });
    clock = T1;

    const updated = await projects.update("p1", {
      name: "Renamed",
      coordinator: { provider: "claude-code", model: "claude-opus-4-8", effort: null },
    });

    expect(updated).toEqual({
      ...created,
      name: "Renamed",
      coordinator: { provider: "claude-code", model: "claude-opus-4-8", effort: null },
      updatedAt: T1.toISOString(),
    });
    expect(await projects.getById("p1")).toEqual(updated);
  });

  test("an update can clear a text setting and replace or empty the repo list", async () => {
    await projects.create({ id: "p1", ...projectSettings({ repoIds: ["r1", "r2"] }) });

    await projects.update("p1", { goal: "", repoIds: ["r3"] });
    expect(await projects.getById("p1")).toMatchObject({ goal: "", repoIds: ["r3"] });

    await projects.update("p1", { repoIds: [] });
    expect((await projects.getById("p1"))?.repoIds).toEqual([]);
  });

  test("updating or pausing a project that does not exist does nothing", async () => {
    expect(await projects.update("missing", { name: "x" })).toBeNull();
    expect(await projects.setStatus("missing", "paused")).toBeNull();
    expect(await projects.list()).toEqual([]);
  });

  test("status changes leave the settings alone", async () => {
    const created = await projects.create({ id: "p1", ...projectSettings({ repoIds: ["r1"] }) });
    clock = T1;

    const paused = await projects.setStatus("p1", "paused");

    expect(paused).toEqual({ ...created, status: "paused", updatedAt: T1.toISOString() });
    expect(await projects.getById("p1")).toEqual(paused);
  });

  test("a create that names an unknown repo leaves no project behind", async () => {
    await expect(
      projects.create({ id: "p1", ...projectSettings({ repoIds: ["r1", "no-such-repo"] }) }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);

    expect(await projects.getById("p1")).toBeNull();
  });

  test("its writes join a transaction the caller owns and roll back with it", async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        const inTransaction = createProjectRepository(trx, () => clock);
        await inTransaction.create({ id: "p1", ...projectSettings({ repoIds: ["r1"] }) });
        await inTransaction.update("p1", { name: "Renamed" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect(await projects.getById("p1")).toBeNull();
    expect(await db.selectFrom("project_repos").selectAll().execute()).toEqual([]);
  });

  test("removes a project with its repo links, and reports a second removal as absent", async () => {
    await projects.create({ id: "p1", ...projectSettings({ repoIds: ["r1"] }) });

    expect(await projects.remove("p1")).toBe(true);
    expect(await projects.remove("p1")).toBe(false);

    expect(await projects.getById("p1")).toBeNull();
    expect(await db.selectFrom("project_repos").selectAll().execute()).toEqual([]);
  });

  test("refuses to remove a project while a session still belongs to it", async () => {
    await projects.create({ id: "p1", ...projectSettings() });
    await insertProjectSession(db, { id: "thread-1", projectId: "p1", kind: "thread" });

    await expect(projects.remove("p1")).rejects.toThrow(/FOREIGN KEY constraint failed/);

    expect(await projects.getById("p1")).not.toBeNull();
  });
});
