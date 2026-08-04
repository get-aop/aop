import { describe, expect, test } from "bun:test";
import type { Task } from "../types";
import { dashboardStatusUnchanged, refreshDashboardStatus } from "./useTaskEventsRefresh";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const statusWithTask = (task: Task) => ({
  ready: true,
  tasks: [task],
  capacity: { working: 0, max: 1 },
  swimlanes: [],
  repos: [],
});

const task = (id: string): Task =>
  ({
    id,
    repoId: "repo-1",
    repoPath: "/repo-1",
    changePath: `changes/${id}`,
    status: "READY",
    baseBranch: null,
    preferredProvider: null,
    preferredWorkflow: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) satisfies Task;

describe("useTaskEvents", () => {
  test("keeps the latest refresh result when snapshots resolve out of order", async () => {
    const first = createDeferred<ReturnType<typeof statusWithTask>>();
    const second = createDeferred<ReturnType<typeof statusWithTask>>();
    const statuses = [first.promise, second.promise];
    const applied: string[] = [];
    let latestSeq = 0;

    const nextStatus = () => {
      const status = statuses.shift();
      if (!status) throw new Error("Expected queued dashboard status");
      return status;
    };

    const refresh = () =>
      refreshDashboardStatus({
        nextSeq: () => ++latestSeq,
        getLatestSeq: () => latestSeq,
        loadStatus: nextStatus,
        applyStatus: (status) => applied.push(status.tasks.map((item) => item.id).join(",")),
      });

    const firstRefresh = refresh();
    const secondRefresh = refresh();

    second.resolve(statusWithTask(task("latest")));
    await secondRefresh;
    expect(applied).toEqual(["latest"]);

    first.resolve(statusWithTask(task("stale")));
    await firstRefresh;
    expect(applied).toEqual(["latest"]);
  });

  test("dashboardStatusUnchanged is true for identical poll payloads", () => {
    const status = statusWithTask(task("t1"));
    const prev = {
      tasks: status.tasks,
      capacity: status.capacity,
      swimlanes: status.swimlanes,
      repos: status.repos,
      connected: true,
      initialized: true,
    };
    expect(dashboardStatusUnchanged(prev, status)).toBe(true);
    const working = task("t1");
    working.status = "WORKING";
    expect(dashboardStatusUnchanged(prev, { ...status, tasks: [working] })).toBe(false);
  });
});
