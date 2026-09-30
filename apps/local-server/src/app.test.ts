import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { type AppDependencies, createApp } from "./app.ts";
import { createCommandContext, type LocalServerContext } from "./context.ts";
import type { Database } from "./db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo } from "./db/test-utils.ts";

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
    deps = { ctx, startTimeMs: Date.now() - 5000 };
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
    });
  });

  describe("GET /api/status", () => {
    test("returns no repos before any is registered", async () => {
      const res = await app.request("/api/status");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ repos: [] });
    });

    test("lists the registered repos", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");

      const res = await app.request("/api/status");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.repos).toEqual([
        { id: "repo-1", name: "repo1", path: aopPaths.repoDir("repo-1") },
      ]);
    });
  });

  describe("removed task-era routes", () => {
    test("does not mount Linear, Jira, GitHub App, task, or workflow routes", async () => {
      expect((await app.request("/api/linear/status")).status).toBe(404);
      expect((await app.request("/api/jira/status")).status).toBe(404);
      expect((await app.request("/api/github/status")).status).toBe(404);
      expect((await app.request("/api/workflows")).status).toBe(404);
      expect((await app.request("/api/repos/repo-1/tasks/task-1/executions")).status).toBe(404);
      expect((await app.request("/api/refresh", { method: "POST" })).status).toBe(404);
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
