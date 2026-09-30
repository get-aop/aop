import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createUsageRepository, type UsageBounds, type UsageRepository } from "./repository.ts";
import { entry, seedUsageWorld } from "./test-utils.ts";

const OPEN: UsageBounds = { since: null, until: null };
const T1 = "2026-09-30T10:00:00.000Z";
const T2 = "2026-09-30T11:00:00.000Z";
const T3 = "2026-09-30T12:00:00.000Z";

describe("usage repository", () => {
  let db: Kysely<Database>;
  let repository: UsageRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repository = createUsageRepository(db);
    await seedUsageWorld(db, {
      crd_1: ["run_c"],
      thr_1: ["run_a", "run_b"],
      thr_2: ["run_d"],
      thr_other: ["run_x"],
      plain_1: ["run_p"],
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  const listRuns = async (
    scope: Parameters<UsageRepository["list"]>[0],
    bounds = OPEN,
  ): Promise<string[]> => (await repository.list(scope, bounds)).map((record) => record.runId);

  test("stores a run's usage per model and reads it back with its session", async () => {
    await repository.record(
      "run_a",
      "claude-code",
      [entry({ model: "opus" }), entry({ model: "haiku", inputTokens: 99, costUsd: null })],
      T1,
    );

    const records = await repository.list({ kind: "run", id: "run_a" }, OPEN);

    expect(records.map((record) => [record.model, record.inputTokens, record.costUsd])).toEqual([
      ["haiku", 99, null],
      ["opus", 10, 0.5],
    ]);
    expect(records[0]).toMatchObject({
      runId: "run_a",
      provider: "claude-code",
      sessionId: "thr_1",
      sessionTitle: "thr_1",
      sessionKind: "thread",
      cacheWriteTokens: 200,
      cacheReadTokens: 4000,
    });
  });

  test("recording a run again replaces what it recorded before", async () => {
    await repository.record("run_a", "claude-code", [entry({ model: "opus" })], T1);
    await repository.record("run_a", "claude-code", [entry({ model: "haiku" })], T2);

    const records = await repository.list({ kind: "run", id: "run_a" }, OPEN);

    expect(records.map((record) => record.model)).toEqual(["haiku"]);
  });

  test("scopes by run, by session, and by project without crossing projects or plain sessions", async () => {
    for (const runId of ["run_a", "run_b", "run_c", "run_d", "run_x", "run_p"]) {
      await repository.record(runId, "claude-code", [entry()], T1);
    }

    expect(await listRuns({ kind: "run", id: "run_b" })).toEqual(["run_b"]);
    expect((await listRuns({ kind: "session", id: "thr_1" })).sort()).toEqual(["run_a", "run_b"]);
    expect((await listRuns({ kind: "project", id: "prj_1" })).sort()).toEqual([
      "run_a",
      "run_b",
      "run_c",
      "run_d",
    ]);
    expect(await listRuns({ kind: "session", id: "plain_1" })).toEqual(["run_p"]);
    expect((await repository.list({ kind: "session", id: "plain_1" }, OPEN))[0]?.sessionKind).toBe(
      null,
    );
  });

  test("a window includes its start and excludes its end", async () => {
    await repository.record("run_a", "claude-code", [entry()], T1);
    await repository.record("run_b", "claude-code", [entry()], T2);
    await repository.record("run_d", "claude-code", [entry()], T3);
    const project = { kind: "project", id: "prj_1" } as const;

    expect(await listRuns(project, { since: T2, until: null })).toEqual(["run_b", "run_d"]);
    expect(await listRuns(project, { since: null, until: T2 })).toEqual(["run_a"]);
    expect(await listRuns(project, { since: T1, until: T3 })).toEqual(["run_a", "run_b"]);
    expect(await listRuns(project, { since: T3, until: T3 })).toEqual([]);
  });

  test("knows which sessions, projects and runs exist", async () => {
    expect(await repository.exists({ kind: "session", id: "thr_1" })).toBe(true);
    expect(await repository.exists({ kind: "session", id: "prj_1" })).toBe(false);
    expect(await repository.exists({ kind: "project", id: "prj_2" })).toBe(true);
    expect(await repository.exists({ kind: "project", id: "thr_1" })).toBe(false);
    expect(await repository.getRunSessionId("run_a")).toBe("thr_1");
    expect(await repository.getRunSessionId("nope")).toBeNull();
  });

  test("deleting a session takes its usage with it", async () => {
    await repository.record("run_a", "claude-code", [entry()], T1);
    await repository.record("run_d", "claude-code", [entry()], T1);

    await db.deleteFrom("chat_sessions").where("id", "=", "thr_1").execute();

    expect(await listRuns({ kind: "project", id: "prj_1" })).toEqual(["run_d"]);
    const rows = await db.selectFrom("run_usage").select("run_id").execute();
    expect(rows.map((row) => row.run_id)).toEqual(["run_d"]);
  });

  test("refuses usage for a run that does not exist, and negative counts", async () => {
    await expect(repository.record("ghost", "claude-code", [entry()], T1)).rejects.toThrow(
      /FOREIGN KEY/,
    );

    const negative = repository.record("run_a", "claude-code", [entry({ inputTokens: -1 })], T1);
    await expect(negative).rejects.toThrow(/CHECK/);
    expect(await listRuns({ kind: "run", id: "run_a" })).toEqual([]);
  });

  test("a failed replacement leaves the earlier record in place", async () => {
    await repository.record("run_a", "claude-code", [entry({ model: "opus" })], T1);

    await expect(
      repository.record("run_a", "claude-code", [entry({ outputTokens: -5 })], T2),
    ).rejects.toThrow();

    const records = await repository.list({ kind: "run", id: "run_a" }, OPEN);
    expect(records.map((record) => record.model)).toEqual(["opus"]);
  });

  test("the table has no column that belongs to one provider", async () => {
    const { rows } = await sql<{ name: string }>`PRAGMA table_info(run_usage)`.execute(db);

    expect(rows.map((row) => row.name).sort()).toEqual([
      "cache_read_tokens",
      "cache_write_tokens",
      "cost_usd",
      "input_tokens",
      "model",
      "output_tokens",
      "provider",
      "recorded_at",
      "run_id",
    ]);
  });
});
