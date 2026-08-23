import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { type AppDependencies, createApp } from "./app.ts";
import { createCommandContext, type LocalServerContext } from "./context.ts";
import type { Database } from "./db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "./db/test-utils.ts";

describe("app", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let deps: AppDependencies;
  let app: ReturnType<typeof createApp>;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    deps = {
      ctx,
      startTimeMs: Date.now() - 5000,
      orchestratorStatus: () => ({
        watcher: "running",
        ticker: "running",
        processor: "running",
        scheduler: "stopped",
      }),
      isReady: () => true,
      triggerRefresh: () => true,
    };
    app = createApp(deps);
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  describe("GET /api/health", () => {
    test("returns health status with all components", async () => {
      const res = await app.request("/api/health");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.service).toBe("aop");
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.db.connected).toBe(true);
      expect(body.orchestrator).toEqual({
        watcher: "running",
        ticker: "running",
        processor: "running",
        scheduler: "stopped",
      });
    });

    test("returns default orchestrator status when not provided", async () => {
      const appWithoutOrchestrator = createApp({
        ctx,
        startTimeMs: Date.now(),
      });

      const res = await appWithoutOrchestrator.request("/api/health");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.orchestrator).toEqual({
        watcher: "stopped",
        ticker: "stopped",
        processor: "stopped",
      });
    });
  });

  describe("GET /api/status", () => {
    test("returns empty status when no repos", async () => {
      const res = await app.request("/api/status");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.repos).toEqual([]);
    });

    test("returns repos with their tasks", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1", {
        maxConcurrentTasks: 2,
      });
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const res = await app.request("/api/status");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.repos).toHaveLength(1);
      expect(body.repos[0].id).toBe("repo-1");
      expect(body.repos[0].path).toBe(aopPaths.repoDir("repo-1"));
      expect(body.repos[0].max).toBe(2);
      expect(body.repos[0].tasks).toHaveLength(2);
    });

    test("excludes REMOVED tasks from repo tasks", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "REMOVED");

      const res = await app.request("/api/status");
      const body: AnyJson = await res.json();

      expect(body.repos[0].tasks).toHaveLength(1);
      expect(body.repos[0].tasks[0].id).toBe("task-1");
    });

    test("returns ready=false when orchestrator not ready", async () => {
      const appNotReady = createApp({
        ctx,
        startTimeMs: Date.now(),
        isReady: () => false,
      });

      const res = await appNotReady.request("/api/status");
      const body: AnyJson = await res.json();

      expect(body.ready).toBe(false);
    });
  });

  describe("removed ticket integrations", () => {
    test("does not mount Linear, Jira, or GitHub App routes", async () => {
      expect((await app.request("/api/linear/status")).status).toBe(404);
      expect((await app.request("/api/jira/status")).status).toBe(404);
      expect((await app.request("/api/github/status")).status).toBe(404);
    });
  });

  describe("POST /api/refresh", () => {
    test("triggers refresh successfully", async () => {
      const res = await app.request("/api/refresh", { method: "POST" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.message).toBe("Refresh triggered");
    });

    test("returns 503 when orchestrator not ready", async () => {
      const appNotReady = createApp({
        ctx,
        startTimeMs: Date.now(),
        triggerRefresh: () => false,
      });

      const res = await appNotReady.request("/api/refresh", { method: "POST" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toBe("Orchestrator not ready");
    });

    test("returns 503 when triggerRefresh not provided", async () => {
      const appNoRefresh = createApp({
        ctx,
        startTimeMs: Date.now(),
      });

      const res = await appNoRefresh.request("/api/refresh", {
        method: "POST",
      });

      expect(res.status).toBe(503);
    });
  });

  describe("POST /api/open-external", () => {
    test("opens an https URL with the injected opener", async () => {
      const openExternalUrl = mock(async () => undefined);
      const appWithOpener = createApp({
        ...deps,
        openExternalUrl,
      });

      const res = await appWithOpener.request("/api/open-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/get-aop/aop-mono/pull/99" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/get-aop/aop-mono/pull/99");
    });

    test("rejects non-web external URLs", async () => {
      const openExternalUrl = mock(async () => undefined);
      const appWithOpener = createApp({
        ...deps,
        openExternalUrl,
      });

      const res = await appWithOpener.request("/api/open-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "file:///home/marcelorm/.ssh/id_rsa" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Only https URLs and loopback http URLs can be opened.");
      expect(openExternalUrl).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/metrics", () => {
    test("returns metrics without repoId filter", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "DONE");

      const res = await app.request("/api/metrics");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("byStatus");
    });

    test("returns metrics filtered by repoId", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestRepo(db, "repo-2", "/path/to/repo2");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DONE");
      await createTestTask(db, "task-2", "repo-2", "changes/feat-2", "DONE");

      const res = await app.request("/api/metrics?repoId=repo-1");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.total).toBe(1);
    });
  });

  describe("loop engineering API routes", () => {
    test("mounts provider capabilities with readiness probes", async () => {
      const res = await app.request("/api/providers/capabilities");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.providers.map((provider: { id: string }) => provider.id)).toEqual([
        "claude-code",
        "codex-cli",
        "grok-build",
        "opencode",
        "pi",
      ]);
      expect(body.providers[0].readinessProbe).toHaveProperty("cliInstalled");
      expect(body.providers[0].readinessProbe).toHaveProperty("versionDetected");
      expect(body.providers[0].readinessProbe).toHaveProperty("canWriteLogs");
    });

    test("lists review inbox items and rejects invalid filters", async () => {
      await createTestRepo(db, "repo-review", "/tmp/repo-review");
      await createTestTask(db, "task-review", "repo-review", "docs/tasks/review", "DONE");
      await ctx.taskRepository.update("task-review", { handoff_pending_approval: true });

      const res = await app.request("/api/review-inbox?source=approval");
      const body: AnyJson = await res.json();
      const invalid = await app.request("/api/review-inbox?severity=urgent");

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        type: "handoff_approval",
        taskId: "task-review",
      });
      expect(invalid.status).toBe(400);
    });

    test("creates, lists, and consumes signals through API routes", async () => {
      await createTestRepo(db, "repo-signals", "/tmp/repo-signals");

      const createRes = await app.request("/api/signals", {
        method: "POST",
        body: JSON.stringify({
          repoId: "repo-signals",
          kind: "docs-gap",
          title: "Document the runtime check",
          body: "The provider doctor needs operator-facing docs.",
          provenance: "human",
          confidence: "medium",
        }),
      });
      const createBody: AnyJson = await createRes.json();

      const listRes = await app.request("/api/signals?repoId=repo-signals");
      const listBody: AnyJson = await listRes.json();

      const consumeRes = await app.request(`/api/signals/${createBody.signal.id}/consume`, {
        method: "POST",
      });
      const consumeBody: AnyJson = await consumeRes.json();

      const consumedAgain = await app.request(`/api/signals/${createBody.signal.id}/consume`, {
        method: "POST",
      });

      expect(createRes.status).toBe(201);
      expect(listRes.status).toBe(200);
      expect(listBody.signals).toHaveLength(1);
      expect(consumeRes.status).toBe(200);
      expect(consumeBody.task.status).toBe("DRAFT");
      expect(consumedAgain.status).toBe(409);
    });

    test("rejects invalid signal payloads", async () => {
      const res = await app.request("/api/signals", {
        method: "POST",
        body: JSON.stringify({
          repoId: "",
          kind: "not-a-kind",
          title: "Bad signal",
        }),
      });

      expect(res.status).toBe(400);
    });
  });
});

describe("app - test mode endpoint", () => {
  const originalTestMode = process.env.AOP_TEST_MODE;
  let cleanupAopHome: () => void;

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
    process.env.AOP_TEST_MODE = "true";
  });

  afterEach(() => {
    cleanupAopHome();
    if (originalTestMode !== undefined) {
      process.env.AOP_TEST_MODE = originalTestMode;
    } else {
      delete process.env.AOP_TEST_MODE;
    }
  });

  test("PATCH /api/tasks/:taskId/status updates task status", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const app = createApp({ ctx, startTimeMs: Date.now() });

    await createTestRepo(db, "repo-1", "/path/to/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

    const res = await app.request("/api/tasks/task-1/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "READY" }),
    });
    const body: AnyJson = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.task.status).toBe("READY");

    await db.destroy();
  });

  test("PATCH /api/tasks/:taskId/status returns 400 for invalid status", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const app = createApp({ ctx, startTimeMs: Date.now() });

    await createTestRepo(db, "repo-1", "/path/to/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

    const res = await app.request("/api/tasks/task-1/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "INVALID" }),
    });
    const body: AnyJson = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid status");

    await db.destroy();
  });

  test("PATCH /api/tasks/:taskId/status returns 404 for non-existent task", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const app = createApp({ ctx, startTimeMs: Date.now() });

    const res = await app.request("/api/tasks/non-existent/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "READY" }),
    });
    const body: AnyJson = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Task not found");

    await db.destroy();
  });
});

describe("app - static file serving", () => {
  test("serves static files from dashboardStaticPath", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    // Create a temp dir with test files
    const tempDir = `/tmp/aop-test-static-${Date.now()}`;
    const { mkdirSync, writeFileSync, rmSync, existsSync } = await import("node:fs");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(`${tempDir}/index.html`, "<html><body>Test</body></html>");
    writeFileSync(`${tempDir}/style.css`, "body { color: red; }");
    writeFileSync(`${tempDir}/main-pgsvk45c.js`, "console.log('bundle')");

    const app = createApp({
      ctx,
      startTimeMs: Date.now(),
      dashboardStaticPath: tempDir,
    });

    // index.html must revalidate every load so updated hashed bundles are picked up.
    const htmlRes = await app.request("/");
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("Content-Type")).toBe("text/html");
    expect(htmlRes.headers.get("Cache-Control")).toBe("no-cache");

    // Unhashed asset also revalidates.
    const cssRes = await app.request("/style.css");
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get("Content-Type")).toBe("text/css");
    expect(cssRes.headers.get("Cache-Control")).toBe("no-cache");

    // Content-hashed bundle is immutable and cached long-term.
    const jsRes = await app.request("/main-pgsvk45c.js");
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");

    // Non-existent file should fall back to SPA (revalidating).
    const spaRes = await app.request("/some/route");
    expect(spaRes.status).toBe(200);
    expect(spaRes.headers.get("Content-Type")).toBe("text/html");
    expect(spaRes.headers.get("Cache-Control")).toBe("no-cache");

    // Cleanup
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }

    await db.destroy();
  });

  test("returns 404 for /api/* routes when dashboardStaticPath is set", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    const tempDir = `/tmp/aop-test-static-api-${Date.now()}`;
    const { mkdirSync, rmSync, existsSync, writeFileSync } = await import("node:fs");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(`${tempDir}/index.html`, "<html></html>");

    const app = createApp({
      ctx,
      startTimeMs: Date.now(),
      dashboardStaticPath: tempDir,
    });

    const res = await app.request("/api/nonexistent");
    expect(res.status).toBe(404);

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }

    await db.destroy();
  });

  test("returns 404 when index.html does not exist", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    const tempDir = `/tmp/aop-test-static-no-index-${Date.now()}`;
    const { mkdirSync, rmSync, existsSync } = await import("node:fs");
    mkdirSync(tempDir, { recursive: true });

    const app = createApp({
      ctx,
      startTimeMs: Date.now(),
      dashboardStaticPath: tempDir,
    });

    const res = await app.request("/some/route");
    expect(res.status).toBe(404);

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }

    await db.destroy();
  });

  test("serves a dashboard unavailable page when no static dashboard is attached", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    const app = createApp({
      ctx,
      startTimeMs: Date.now(),
      dashboardDevOrigin: "http://localhost:25160",
    });

    const res = await app.request("/");
    const html = await res.text();

    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain("Dashboard unavailable on this server");
    expect(html).toContain("http://localhost:25160");
    expect(html).toContain("/api/health");

    await db.destroy();
  });
});

describe("app - local workflows", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = createApp({ ctx, startTimeMs: Date.now() });
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("returns local workflows without the retired built-ins", async () => {
    const res = await app.request("/api/workflows");
    const body: AnyJson = await res.json();

    expect(res.status).toBe(200);
    expect(body.workflows).toEqual([]);
  });

  test("returns workflows in sorted order", async () => {
    const res = await app.request("/api/workflows");
    const body: AnyJson = await res.json();
    expect(body.workflows).toEqual([...body.workflows].sort());
  });
});

describe("app - filesystem routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: ReturnType<typeof createApp>;
  let testDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = createApp({ ctx, startTimeMs: Date.now() });

    const { mkdirSync } = await import("node:fs");
    testDir = `/tmp/aop-app-fs-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
    mkdirSync(`${testDir}/projects`);
    mkdirSync(`${testDir}/.hidden`);
  });

  afterEach(async () => {
    const { rmSync, existsSync } = await import("node:fs");
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    await db.destroy();
  });

  test("GET /api/fs/directories lists directories", async () => {
    const res = await app.request(`/api/fs/directories?path=${encodeURIComponent(testDir)}`);
    const body: AnyJson = await res.json();

    expect(res.status).toBe(200);
    expect(body.path).toBe(testDir);
    expect(body.directories).toContain("projects");
    expect(body.directories).not.toContain(".hidden");
  });

  test("GET /api/fs/directories includes hidden when hidden=true", async () => {
    const res = await app.request(
      `/api/fs/directories?path=${encodeURIComponent(testDir)}&hidden=true`,
    );
    const body: AnyJson = await res.json();

    expect(res.status).toBe(200);
    expect(body.directories).toContain(".hidden");
  });

  test("GET /api/fs/directories returns 404 for non-existent path", async () => {
    const res = await app.request("/api/fs/directories?path=/non/existent/path");
    const body: AnyJson = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Path not found");
  });
});
