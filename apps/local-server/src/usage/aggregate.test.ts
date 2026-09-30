import { describe, expect, test } from "bun:test";
import { byModel, byThread, totalsOf } from "./aggregate.ts";
import type { UsageRecord } from "./repository.ts";

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  runId: "run_1",
  provider: "claude-code",
  model: "opus",
  inputTokens: 1,
  outputTokens: 2,
  cacheWriteTokens: 3,
  cacheReadTokens: 4,
  costUsd: 0.5,
  sessionId: "thr_1",
  sessionTitle: "Fix cold start",
  sessionKind: "thread",
  ...overrides,
});

describe("totalsOf", () => {
  test("sums every bucket and the cost", () => {
    const totals = totalsOf([record({ runId: "a" }), record({ runId: "b", costUsd: 0.25 })]);

    expect(totals).toEqual({
      inputTokens: 2,
      outputTokens: 4,
      cacheWriteTokens: 6,
      cacheReadTokens: 8,
      costUsd: 0.75,
      runs: 2,
    });
  });

  test("counts a run that used two models once", () => {
    const totals = totalsOf([record({ model: "opus" }), record({ model: "haiku" })]);

    expect(totals.runs).toBe(1);
    expect(totals.inputTokens).toBe(2);
  });

  test("the cost is null until some run reports one, and unreported runs add nothing", () => {
    expect(totalsOf([record({ costUsd: null })]).costUsd).toBeNull();
    expect(totalsOf([record({ costUsd: null }), record({ runId: "b", costUsd: 2 })]).costUsd).toBe(
      2,
    );
    expect(totalsOf([]).costUsd).toBeNull();
  });

  test("a sum of costs carries no floating-point noise", () => {
    const totals = totalsOf([
      record({ runId: "a", costUsd: 0.228_75 }),
      record({ runId: "b", costUsd: 0.008_25 }),
    ]);

    expect(totals.costUsd).toBe(0.237);
  });

  test("nothing recorded is zero, not an error", () => {
    expect(totalsOf([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: null,
      runs: 0,
    });
  });
});

describe("byModel", () => {
  test("merges the same model across runs and sorts the biggest first", () => {
    const models = byModel([
      record({ runId: "a", model: "haiku", cacheReadTokens: 0 }),
      record({ runId: "a", model: "opus", cacheReadTokens: 1000 }),
      record({ runId: "b", model: "haiku", cacheReadTokens: 0 }),
    ]);

    expect(models.map((entry) => [entry.model, entry.runs, entry.inputTokens])).toEqual([
      ["opus", 1, 1],
      ["haiku", 2, 2],
    ]);
  });

  test("equal totals keep a stable order by model", () => {
    const models = byModel([record({ model: "b" }), record({ model: "a" })]);

    expect(models.map((entry) => entry.model)).toEqual(["a", "b"]);
  });
});

describe("byThread", () => {
  test("one row per session with its models, biggest consumer first", () => {
    const rows = byThread([
      record({ sessionId: "crd_1", sessionKind: "coordinator", sessionTitle: "Coordinator" }),
      record({ sessionId: "thr_1", model: "haiku", cacheReadTokens: 900 }),
      record({ sessionId: "thr_1", model: "opus", cacheReadTokens: 100_000 }),
    ]);

    expect(rows.map((row) => row.threadId)).toEqual(["thr_1", "crd_1"]);
    expect(rows[0]).toMatchObject({
      kind: "thread",
      title: "Fix cold start",
      models: ["opus", "haiku"],
      runs: 1,
    });
    expect(rows[1]).toMatchObject({ kind: "coordinator", models: ["opus"] });
  });

  test("leaves out a session that belongs to no project", () => {
    expect(byThread([record({ sessionKind: null })])).toEqual([]);
  });
});
