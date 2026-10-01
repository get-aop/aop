import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createKickoffRepository, type KickoffRepository } from "./kickoff-repository.ts";
import { insertProjectRow, insertProjectSession } from "./test-utils.ts";

describe("kickoff repository", () => {
  let db: Kysely<Database>;
  let kickoffs: KickoffRepository;

  beforeEach(async () => {
    db = await createTestDb();
    kickoffs = createKickoffRepository(db);
    for (const id of ["p1", "p2", "p3"]) await insertProjectRow(db, id);
    for (const id of ["s1", "s2"]) {
      await insertProjectSession(db, { id, projectId: "p1", kind: "thread" });
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  const rows = () => db.selectFrom("project_kickoffs").selectAll().orderBy("project_id").execute();

  test("lists the kickoffs whose survey is still to be started", async () => {
    await kickoffs.insertPending("p1");
    await kickoffs.insertPending("p2");
    await kickoffs.claimSurvey("p2", "s2");

    expect(await kickoffs.listPending()).toEqual(["p1"]);
  });

  test("a pending kickoff is claimed by one survey only", async () => {
    await kickoffs.insertPending("p1");

    expect(await kickoffs.claimSurvey("p1", "s1")).toBe(true);
    expect(await kickoffs.claimSurvey("p1", "s2")).toBe(false);
    expect(await kickoffs.claimSurvey("p3", "s2")).toBe(false);
    expect(await rows()).toEqual([
      { project_id: "p1", state: "surveying", survey_thread_id: "s1" },
    ]);
  });

  test("a survey's report is asked for once, and only from a survey", async () => {
    await kickoffs.insertPending("p1");
    await kickoffs.claimSurvey("p1", "s1");

    expect(await kickoffs.markReported("s2")).toBe(false);
    expect(await kickoffs.markReported("s1")).toBe(true);
    expect(await kickoffs.markReported("s1")).toBe(false);
    expect(await rows()).toEqual([{ project_id: "p1", state: "reported", survey_thread_id: "s1" }]);
  });
});
