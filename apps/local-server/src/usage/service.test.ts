import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createUsageRepository } from "./repository.ts";
import { createUsageService, type UsageService } from "./service.ts";
import { claudeLog, entry, initEvent, resultEvent, seedUsageWorld } from "./test-utils.ts";

const OPEN = { since: null, until: null };
const FINISHED_AT = new Date("2026-09-30T10:30:00.000Z");

let logDir: string;
beforeAll(() => {
  logDir = mkdtempSync(join(tmpdir(), "aop-usage-service-"));
});
afterAll(() => {
  rmSync(logDir, { recursive: true, force: true });
});

const writeLog = (name: string, content: string): string => {
  const path = join(logDir, name);
  writeFileSync(path, content);
  return path;
};

const turnLog = (input: number, output: number, cacheWrite: number, cacheRead: number) =>
  claudeLog(
    initEvent("fake-model"),
    resultEvent({
      total_cost_usd: 0.25,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
      },
      modelUsage: {
        "fake-model": {
          inputTokens: input,
          outputTokens: output,
          cacheCreationInputTokens: cacheWrite,
          cacheReadInputTokens: cacheRead,
          costUSD: 0.25,
        },
      },
    }),
  );

describe("usage service", () => {
  let db: Kysely<Database>;
  let service: UsageService;

  beforeEach(async () => {
    db = await createTestDb();
    service = createUsageService(db, () => FINISHED_AT);
    await seedUsageWorld(db, {
      crd_1: ["run_c"],
      thr_1: ["run_a", "run_b"],
      thr_2: ["run_d"],
      thr_other: ["run_x"],
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  const record = (runId: string, log: string, runtime = "claude-code") =>
    service.recordRunUsage({ id: runId, runtime, log_file_path: writeLog(`${runId}.jsonl`, log) });

  describe("recordRunUsage", () => {
    test("stores what the log reports, stamped with the finish time and the run's provider", async () => {
      await record("run_a", turnLog(1200, 340, 5000, 61_000));

      const usage = await service.getRunUsage("run_a");

      expect(usage?.totals).toEqual({
        inputTokens: 1200,
        outputTokens: 340,
        cacheWriteTokens: 5000,
        cacheReadTokens: 61_000,
        costUsd: 0.25,
        runs: 1,
      });
      const row = await db.selectFrom("run_usage").selectAll().executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        run_id: "run_a",
        provider: "claude-code",
        model: "fake-model",
        recorded_at: FINISHED_AT.toISOString(),
      });
    });

    test("recording the same run twice does not double its usage", async () => {
      await record("run_a", turnLog(10, 10, 10, 10));
      await record("run_a", turnLog(10, 10, 10, 10));

      expect((await service.getRunUsage("run_a"))?.totals.inputTokens).toBe(10);
    });

    test("does nothing for a log that is missing, empty, or has no usage", async () => {
      await service.recordRunUsage({
        id: "run_a",
        runtime: "claude-code",
        log_file_path: join(logDir, "never-written.jsonl"),
      });
      await record("run_b", "");
      await record("run_d", claudeLog(initEvent()));

      expect(await db.selectFrom("run_usage").selectAll().execute()).toEqual([]);
    });

    test("skips a runtime it has no parser for", async () => {
      await record("run_a", turnLog(1, 1, 1, 1), "codex-cli");

      expect(await db.selectFrom("run_usage").selectAll().execute()).toEqual([]);
    });

    test("never throws: a run that cannot be stored is logged, not raised", async () => {
      await expect(record("run_that_does_not_exist", turnLog(1, 1, 1, 1))).resolves.toBeUndefined();

      expect(await db.selectFrom("run_usage").selectAll().execute()).toEqual([]);
    });
  });

  describe("reads", () => {
    beforeEach(async () => {
      const repository = createUsageRepository(db);
      const at = (hour: number) => `2026-09-30T${String(hour).padStart(2, "0")}:00:00.000Z`;
      await repository.record("run_a", "claude-code", [entry({ model: "opus" })], at(9));
      await repository.record(
        "run_b",
        "claude-code",
        [entry({ model: "opus" }), entry({ model: "haiku", inputTokens: 1, cacheReadTokens: 0 })],
        at(11),
      );
      await repository.record("run_c", "claude-code", [entry({ model: "opus" })], at(12));
      await repository.record("run_x", "claude-code", [entry({ model: "opus" })], at(12));
    });

    test("a run is reported with its thread", async () => {
      const usage = await service.getRunUsage("run_b");

      expect(usage?.threadId).toBe("thr_1");
      expect(usage?.byModel.map((model) => model.model)).toEqual(["opus", "haiku"]);
      expect(usage?.totals.runs).toBe(1);
    });

    test("a run with no usage yet has zero totals, and a missing run is not found", async () => {
      expect((await service.getRunUsage("run_d"))?.totals).toMatchObject({
        inputTokens: 0,
        costUsd: null,
        runs: 0,
      });
      expect(await service.getRunUsage("nope")).toBeNull();
    });

    test("a thread sums its own runs only", async () => {
      const usage = await service.getThreadUsage("thr_1", OPEN);

      expect(usage?.totals).toMatchObject({ inputTokens: 21, runs: 2, costUsd: 1.5 });
      expect(usage?.byModel.map((model) => [model.model, model.runs])).toEqual([
        ["opus", 2],
        ["haiku", 1],
      ]);
      expect(await service.getThreadUsage("nope", OPEN)).toBeNull();
    });

    test("a project sums the coordinator and every thread, and lists each as a row", async () => {
      const usage = await service.getProjectUsage("prj_1", OPEN);

      expect(usage?.totals).toMatchObject({ runs: 3, inputTokens: 31 });
      expect(usage?.threads.map((thread) => [thread.threadId, thread.kind, thread.runs])).toEqual([
        ["thr_1", "thread", 2],
        ["crd_1", "coordinator", 1],
      ]);
      expect(usage?.threads[0]?.models).toEqual(["opus", "haiku"]);
      expect(await service.getProjectUsage("nope", OPEN)).toBeNull();
    });

    test("a window narrows every total and is echoed back in UTC", async () => {
      const usage = await service.getProjectUsage("prj_1", {
        since: "2026-09-30T12:30:00+02:00",
        until: "2026-09-30T14:30:00+02:00",
      });

      // 10:30Z up to 12:30Z holds run_b (11:00Z) and run_c (12:00Z), not run_a (09:00Z).
      expect(usage?.window).toEqual({
        since: "2026-09-30T10:30:00.000Z",
        until: "2026-09-30T12:30:00.000Z",
      });
      expect(usage?.totals.runs).toBe(2);
      expect(usage?.threads.map((thread) => thread.threadId).sort()).toEqual(["crd_1", "thr_1"]);
    });
  });
});
