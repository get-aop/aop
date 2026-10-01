import type { MemoryFile, ProjectUsage } from "@aop/common";

export const AT = "2026-09-30T10:00:00.000Z";

export const makeMemoryFile = (overrides: Partial<MemoryFile> = {}): MemoryFile => ({
  name: "testing.md",
  description: "How to run the tests",
  body: "Run bun test.",
  updatedAt: AT,
  ...overrides,
});

const totals = (overrides: Partial<ProjectUsage["totals"]> = {}): ProjectUsage["totals"] => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  costUsd: null,
  runs: 0,
  ...overrides,
});

/** A project with one coordinator turn and one thread turn, both on Opus 5, the thread costing money. */
export const makeUsage = (): ProjectUsage => ({
  projectId: "prj_1",
  window: { since: null, until: null },
  totals: totals({
    inputTokens: 1010,
    outputTokens: 205,
    cacheWriteTokens: 3200,
    cacheReadTokens: 54000,
    costUsd: 0.171525,
    runs: 2,
  }),
  byModel: [
    {
      provider: "claude-code",
      model: "claude-opus-5",
      ...totals({
        inputTokens: 1010,
        outputTokens: 205,
        cacheWriteTokens: 3200,
        cacheReadTokens: 54000,
        costUsd: 0.171525,
        runs: 2,
      }),
    },
  ],
  threads: [
    {
      threadId: "thr_1",
      kind: "thread",
      title: "Fix the login redirect",
      models: ["claude-opus-5"],
      lastRunAt: "2026-09-30T09:00:00.000Z",
      ...totals({
        inputTokens: 1000,
        outputTokens: 200,
        cacheWriteTokens: 3000,
        cacheReadTokens: 50000,
        costUsd: 0.16125,
        runs: 1,
      }),
    },
    {
      threadId: "sess_coord",
      kind: "coordinator",
      title: "checkout-service",
      models: ["claude-opus-5"],
      lastRunAt: AT,
      ...totals({
        inputTokens: 10,
        outputTokens: 5,
        cacheWriteTokens: 200,
        cacheReadTokens: 4000,
        costUsd: 0.010275,
        runs: 1,
      }),
    },
  ],
  codeChanges: { additions: 1234, deletions: 56 },
});

export const EMPTY_USAGE: ProjectUsage = {
  projectId: "prj_1",
  window: { since: null, until: null },
  totals: totals(),
  byModel: [],
  threads: [],
  codeChanges: { additions: 0, deletions: 0 },
};
