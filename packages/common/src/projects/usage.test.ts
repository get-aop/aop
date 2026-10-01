import { describe, expect, test } from "bun:test";
import { AT, LATER, parsed, rejectedPaths } from "./test-utils.ts";
import {
  ProjectUsageSchema,
  RunUsageSchema,
  ThreadUsageSchema,
  UsageTotalsSchema,
  UsageWindowSchema,
} from "./usage.ts";

const totals = (overrides: Record<string, unknown> = {}) => ({
  inputTokens: 1200,
  outputTokens: 340,
  cacheWriteTokens: 5000,
  cacheReadTokens: 61_000,
  costUsd: 0.4321,
  runs: 2,
  ...overrides,
});

const modelUsage = (overrides: Record<string, unknown> = {}) => ({
  ...totals(),
  provider: "claude-code",
  model: "claude-opus-5-5",
  ...overrides,
});

const window = { since: AT, until: LATER };

describe("UsageTotalsSchema", () => {
  test("accepts a run with no reported cost", () => {
    expect(parsed(UsageTotalsSchema, totals({ costUsd: null }))).toEqual(totals({ costUsd: null }));
  });

  test("rejects negative or fractional token counts and a negative cost", () => {
    expect(rejectedPaths(UsageTotalsSchema, totals({ inputTokens: -1 }))).toEqual(["inputTokens"]);
    expect(rejectedPaths(UsageTotalsSchema, totals({ cacheReadTokens: 1.5 }))).toEqual([
      "cacheReadTokens",
    ]);
    expect(rejectedPaths(UsageTotalsSchema, totals({ costUsd: -0.01 }))).toEqual(["costUsd"]);
  });
});

describe("UsageWindowSchema", () => {
  test("accepts open and closed bounds", () => {
    expect(parsed(UsageWindowSchema, { since: null, until: null })).toEqual({
      since: null,
      until: null,
    });
    expect(parsed(UsageWindowSchema, window)).toEqual(window);
  });

  test("rejects a window that ends before it starts, or as it starts", () => {
    expect(UsageWindowSchema.safeParse({ since: LATER, until: AT }).success).toBe(false);
    expect(UsageWindowSchema.safeParse({ since: AT, until: AT }).success).toBe(false);
  });
});

describe("the usage responses", () => {
  test("a run names its thread and breaks its totals down by model", () => {
    const run = { runId: "run_1", threadId: "thr_1", totals: totals(), byModel: [modelUsage()] };

    expect(parsed(RunUsageSchema, run)).toEqual(run);
  });

  test("a model outside the provider catalog is rejected", () => {
    const run = {
      runId: "run_1",
      threadId: "thr_1",
      totals: totals(),
      byModel: [modelUsage({ provider: "grok-build" })],
    };

    expect(rejectedPaths(RunUsageSchema, run)).toEqual(["byModel.0.provider"]);
  });

  test("a thread carries the window its totals cover", () => {
    const thread = { threadId: "thr_1", window, totals: totals(), byModel: [modelUsage()] };

    expect(parsed(ThreadUsageSchema, thread)).toEqual(thread);
  });

  test("a project lists its coordinator and threads as rows of the same totals", () => {
    const project = {
      projectId: "prj_1",
      window,
      totals: totals({ runs: 3 }),
      byModel: [modelUsage({ runs: 3 })],
      threads: [
        {
          ...totals(),
          threadId: "thr_1",
          kind: "thread",
          title: "Fix cold start",
          models: ["a"],
          lastRunAt: "2026-09-30T10:00:00.000Z",
        },
        {
          ...totals({ runs: 1 }),
          threadId: "crd_1",
          kind: "coordinator",
          title: "Coordinator",
          models: ["a", "b"],
          lastRunAt: "2026-09-30T11:00:00.000Z",
        },
      ],
      codeChanges: { additions: 12, deletions: 3 },
    };

    expect(parsed(ProjectUsageSchema, project)).toEqual(project);
    expect(
      rejectedPaths(ProjectUsageSchema, {
        ...project,
        threads: [{ ...project.threads[0], kind: "session" }],
        codeChanges: { additions: -1, deletions: 0 },
      }),
    ).toEqual(["threads.0.kind", "codeChanges.additions"]);
  });
});
