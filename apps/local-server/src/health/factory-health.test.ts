import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { buildFactoryHealthSnapshot, getFactoryHealthSnapshot } from "./factory-health.ts";

const healthyDeps = () => ({
  checkDb: async () => true,
  isGhAuthenticated: async () => true,
  listRecentFailedImports: async () => [],
  listRecentFailedExecutions: async () => [],
  listStaleRunningExecutions: async () => [],
  now: () => new Date("2026-05-15T20:00:00.000Z"),
  orchestratorStatus: () => ({
    watcher: "running" as const,
    ticker: "running" as const,
    processor: "running" as const,
    scheduler: "running" as const,
  }),
});

describe("factory health snapshot", () => {
  let cleanupFns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanupFns.map((cleanup) => cleanup()));
    cleanupFns = [];
  });

  test("summarizes healthy backend and integration state", async () => {
    const snapshot = await buildFactoryHealthSnapshot(healthyDeps());

    expect(snapshot.generatedAt).toBe("2026-05-15T20:00:00.000Z");
    expect(snapshot.severity).toBe("ok");
    // database + orchestrator + github-cli
    expect(snapshot.summary).toEqual({ ok: 3, warning: 0, error: 0 });
    expect(snapshot.services.find((item) => item.id === "database")?.severity).toBe("ok");
    expect(snapshot.integrations.map((item) => item.id)).toEqual(["github-cli"]);
    expect(snapshot.integrations.find((item) => item.id === "linear")).toBeUndefined();
    expect(snapshot.integrations.find((item) => item.id === "jira")).toBeUndefined();
    expect(snapshot.recentFailures).toEqual([]);
  });

  test("flags an unavailable GitHub CLI as an error integration", async () => {
    const snapshot = await buildFactoryHealthSnapshot({
      ...healthyDeps(),
      isGhAuthenticated: async () => false,
    });

    const githubCli = snapshot.integrations.find((item) => item.id === "github-cli");
    expect(githubCli?.severity).toBe("error");
    expect(githubCli?.message).toContain("GitHub CLI");
    expect(snapshot.severity).toBe("error");
  });

  test("reports a healthy GitHub CLI as ok", async () => {
    const snapshot = await buildFactoryHealthSnapshot(healthyDeps());

    expect(snapshot.integrations.find((item) => item.id === "github-cli")?.severity).toBe("ok");
  });

  test("does not flag the scheduler when it is disabled by default", async () => {
    const snapshot = await buildFactoryHealthSnapshot({
      ...healthyDeps(),
      orchestratorStatus: () => ({
        watcher: "running" as const,
        ticker: "running" as const,
        processor: "running" as const,
        scheduler: "disabled" as const,
      }),
    });

    const orchestrator = snapshot.services.find((item) => item.id === "orchestrator");
    expect(orchestrator?.severity).toBe("ok");
    expect(snapshot.severity).toBe("ok");
  });

  test("surfaces actionable degraded states without leaking secrets", async () => {
    const snapshot = await buildFactoryHealthSnapshot({
      ...healthyDeps(),
      checkDb: async () => false,
      listRecentFailedImports: async () => [
        {
          id: "import-task-1",
          label: "Import GET-37",
          message: "Token Bearer super-secret-token expired",
          updatedAt: "2026-05-15T19:59:00.000Z",
        },
      ],
      listRecentFailedExecutions: async () => [
        {
          id: "execution-exec-1",
          label: "Task docs/tasks/get-37 failed",
          message: "Step failed: tests failed",
          updatedAt: "2026-05-15T19:58:00.000Z",
        },
      ],
      listStaleRunningExecutions: async () => [
        {
          id: "stale-step-1",
          label: "Stale task docs/tasks/get-38",
          message: "No runtime activity for 45 minutes",
          updatedAt: "2026-05-15T19:15:00.000Z",
        },
      ],
      orchestratorStatus: () => ({
        watcher: "running" as const,
        ticker: "stopped" as const,
        processor: "running" as const,
        scheduler: "stopped" as const,
      }),
    });

    expect(snapshot.severity).toBe("error");
    // services: db error + orchestrator warning; integrations: github-cli ok; failures: 3
    expect(snapshot.summary).toEqual({ ok: 1, warning: 2, error: 3 });
    expect(snapshot.services.find((item) => item.id === "database")?.message).toBe(
      "SQLite health check failed.",
    );
    expect(snapshot.recentFailures.map((item) => item.id)).toEqual([
      "import-task-1",
      "execution-exec-1",
      "stale-step-1",
    ]);
    expect(snapshot.recentFailures[0]?.message).not.toContain("super-secret-token");
    expect(snapshot.recentFailures[0]?.message).toContain("[redacted]");
  });

  test("ignores stale failure records outside the recent health window", async () => {
    const snapshot = await buildFactoryHealthSnapshot({
      ...healthyDeps(),
      listRecentFailedImports: async () => [
        {
          id: "import-task-old",
          label: "Import task_old",
          message: "Old import failed",
          updatedAt: "2026-05-10T20:00:00.000Z",
        },
      ],
      listRecentFailedExecutions: async () => [
        {
          id: "execution-exec-old",
          label: "Task docs/tasks/old failed",
          message: "Old execution failed",
          updatedAt: "2026-05-10T20:00:00.000Z",
        },
      ],
    });

    expect(snapshot.severity).toBe("ok");
    expect(snapshot.recentFailures).toEqual([]);
  });

  test("does not surface failed executions for tasks that are already resolved", async () => {
    const db = await createTestDb();
    const repoPath = join(tmpdir(), `aop-health-repo-${Date.now()}-${Math.random()}`);
    cleanupFns.push(() => db.destroy());
    cleanupFns.push(() => rm(repoPath, { recursive: true, force: true }));

    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", repoPath);
    await createTestTask(db, "task-done", "repo-1", "get-done", "DONE");
    await createTestTask(db, "task-blocked", "repo-1", "get-blocked", "BLOCKED");
    await ctx.taskRepository.refresh();
    await ctx.executionRepository.createExecution({
      id: "exec-done",
      task_id: "task-done",
      status: "failed",
      started_at: "2026-05-15T19:00:00.000Z",
      completed_at: "2026-05-15T19:30:00.000Z",
    });
    await ctx.executionRepository.createExecution({
      id: "exec-blocked",
      task_id: "task-blocked",
      status: "failed",
      started_at: "2026-05-15T19:05:00.000Z",
      completed_at: "2026-05-15T19:35:00.000Z",
    });

    const snapshot = await getFactoryHealthSnapshot({
      ctx,
      now: () => new Date("2026-05-15T20:00:00.000Z"),
      orchestratorStatus: healthyDeps().orchestratorStatus,
    });

    expect(snapshot.recentFailures.map((item) => item.id)).toEqual(["execution-exec-blocked"]);
  });

  test("does not surface failed execution history after a task leaves the blocked state", async () => {
    const db = await createTestDb();
    const repoPath = join(tmpdir(), `aop-health-repo-${Date.now()}-${Math.random()}`);
    cleanupFns.push(() => db.destroy());
    cleanupFns.push(() => rm(repoPath, { recursive: true, force: true }));

    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", repoPath);
    await createTestTask(db, "task-ready", "repo-1", "get-ready", "READY");
    await createTestTask(db, "task-working", "repo-1", "get-working", "WORKING");
    await ctx.taskRepository.refresh();
    await ctx.executionRepository.createExecution({
      id: "exec-ready",
      task_id: "task-ready",
      status: "failed",
      started_at: "2026-05-15T19:00:00.000Z",
      completed_at: "2026-05-15T19:30:00.000Z",
    });
    await ctx.executionRepository.createExecution({
      id: "exec-working",
      task_id: "task-working",
      status: "failed",
      started_at: "2026-05-15T19:05:00.000Z",
      completed_at: "2026-05-15T19:35:00.000Z",
    });

    const snapshot = await getFactoryHealthSnapshot({
      ctx,
      now: () => new Date("2026-05-15T20:00:00.000Z"),
      orchestratorStatus: healthyDeps().orchestratorStatus,
    });

    expect(snapshot.recentFailures.map((item) => item.id)).not.toContain("execution-exec-ready");
    expect(snapshot.recentFailures.map((item) => item.id)).not.toContain("execution-exec-working");
  });

  test("does not surface stale running executions for tasks that are not working", async () => {
    const db = await createTestDb();
    const repoPath = join(tmpdir(), `aop-health-repo-${Date.now()}-${Math.random()}`);
    cleanupFns.push(() => db.destroy());
    cleanupFns.push(() => rm(repoPath, { recursive: true, force: true }));

    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", repoPath);
    await createTestTask(db, "task-ready", "repo-1", "get-ready", "READY");
    await createTestTask(db, "task-done", "repo-1", "get-done", "DONE");
    await ctx.taskRepository.refresh();
    await ctx.executionRepository.createExecution({
      id: "exec-ready-running",
      task_id: "task-ready",
      status: "running",
      started_at: "2026-05-15T18:00:00.000Z",
    });
    await ctx.executionRepository.createExecution({
      id: "exec-done-running",
      task_id: "task-done",
      status: "running",
      started_at: "2026-05-15T18:05:00.000Z",
    });

    const snapshot = await getFactoryHealthSnapshot({
      ctx,
      now: () => new Date("2026-05-15T20:00:00.000Z"),
      orchestratorStatus: healthyDeps().orchestratorStatus,
    });

    expect(snapshot.recentFailures.map((item) => item.id)).not.toContain(
      "stale-exec-ready-running",
    );
    expect(snapshot.recentFailures.map((item) => item.id)).not.toContain("stale-exec-done-running");
  });

  test("collects failed and stale executions", async () => {
    const db = await createTestDb();
    const repoPath = join(tmpdir(), `aop-health-repo-${Date.now()}-${Math.random()}`);
    cleanupFns.push(() => db.destroy());
    cleanupFns.push(() => rm(repoPath, { recursive: true, force: true }));

    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", repoPath);
    await createTestTask(db, "task-failed", "repo-1", "get-37", "BLOCKED");
    await createTestTask(db, "task-stale", "repo-1", "get-38", "WORKING");
    await ctx.taskRepository.refresh();
    await ctx.executionRepository.createExecution({
      id: "exec-failed",
      task_id: "task-failed",
      status: "failed",
      started_at: "2026-05-15T19:00:00.000Z",
      completed_at: "2026-05-15T19:30:00.000Z",
    });
    await ctx.executionRepository.createExecution({
      id: "exec-stale",
      task_id: "task-stale",
      status: "running",
      started_at: "2026-05-15T18:00:00.000Z",
    });

    const snapshot = await getFactoryHealthSnapshot({
      ctx,
      now: () => new Date("2026-05-15T20:00:00.000Z"),
      orchestratorStatus: healthyDeps().orchestratorStatus,
    });

    expect(snapshot.recentFailures.map((item) => item.id)).toEqual([
      "execution-exec-failed",
      "stale-exec-stale",
    ]);
  });
});
