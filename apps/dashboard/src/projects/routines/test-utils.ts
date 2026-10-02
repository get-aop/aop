import type { Routine, RoutineRun } from "@aop/common";

export const makeRun = (overrides: Partial<RoutineRun> = {}): RoutineRun => ({
  id: "rrun_1",
  routineId: "rtn_1",
  occurrence: "2026-06-01T09:00:00.000Z",
  trigger: "schedule",
  status: "ok",
  reason: null,
  threadId: "thr_1",
  messageId: null,
  createdAt: "2026-06-01T09:00:00.000Z",
  ...overrides,
});

export const makeRoutine = (overrides: Partial<Routine> = {}): Routine => ({
  id: "rtn_1",
  projectId: "p1",
  name: "Morning digest",
  prompt: "Summarize new issues",
  schedule: { kind: "weekdays", time: "09:00" },
  target: "thread",
  repoId: "repo_1",
  model: null,
  effort: null,
  enabled: true,
  catchUp: "skip",
  nextRunAt: "2026-06-02T09:00:00.000Z",
  lastRun: null,
  createdBy: "person",
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-06-01T08:00:00.000Z",
  ...overrides,
});
