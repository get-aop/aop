import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createApp } from "./app.ts";
import { createCommandContext } from "./context.ts";
import type { Database } from "./db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo } from "./db/test-utils.ts";

const TEST_PORT = 25151;
const TEST_SERVER_URL = `http://localhost:${TEST_PORT}`;

const integrationDescribe = process.env.AOP_RUN_INTEGRATION === "1" ? describe : describe.skip;

integrationDescribe("CLI integration tests", () => {
  let db: Kysely<Database>;
  let server: ReturnType<typeof Bun.serve>;
  let tempDir: string;
  let cleanupAopHome: () => void;

  beforeAll(async () => {
    cleanupAopHome = useTestAopHome();
    tempDir = await mkdtemp(join(tmpdir(), "aop-cli-test-"));

    db = await createTestDb();
    const app = createApp({ ctx: createCommandContext(db), startTimeMs: Date.now() });

    server = Bun.serve({
      fetch: app.fetch,
      port: TEST_PORT,
      hostname: "127.0.0.1",
    });
  });

  afterAll(async () => {
    server.stop();
    await db.destroy();
    await rm(tempDir, { recursive: true, force: true });
    cleanupAopHome();
  });

  describe("status endpoint", () => {
    test("returns status with empty repos", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/status`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.repos).toEqual([]);
    });

    test("lists registered repos", async () => {
      await createTestRepo(db, "status-repo", "/path/to/status-repo");

      const response = await fetch(`${TEST_SERVER_URL}/api/status`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      const repo = body.repos.find((r: { id: string }) => r.id === "status-repo");
      expect(repo).toMatchObject({ id: "status-repo", name: "status-repo" });
    });
  });

  describe("settings endpoints", () => {
    test("GET /api/settings returns all settings", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/settings`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.settings).toBeDefined();
      expect(Array.isArray(body.settings)).toBe(true);
    });

    test("PUT /api/settings/:key updates setting", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/settings/max_concurrent_tasks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "5" }),
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.key).toBe("max_concurrent_tasks");
      expect(body.value).toBe("5");
    });

    test("GET /api/settings/:key returns single setting", async () => {
      await fetch(`${TEST_SERVER_URL}/api/settings/max_concurrent_tasks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "3" }),
      });

      const response = await fetch(`${TEST_SERVER_URL}/api/settings/max_concurrent_tasks`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.key).toBe("max_concurrent_tasks");
      expect(body.value).toBe("3");
    });

    test("PUT /api/settings/:key rejects invalid key", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/settings/invalid_key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "test" }),
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid key");
    });
  });

  describe("repo endpoints", () => {
    test("DELETE /api/repos/:id removes repo", async () => {
      await createTestRepo(db, "remove-test-repo", "/path/to/remove-test-repo");

      const response = await fetch(`${TEST_SERVER_URL}/api/repos/remove-test-repo`, {
        method: "DELETE",
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.repoId).toBe("remove-test-repo");
    });

    test("DELETE /api/repos/:id returns 404 for non-existent repo", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/repos/non-existent`, {
        method: "DELETE",
      });
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });
  });

  describe("health endpoint", () => {
    test("returns health status", async () => {
      const response = await fetch(`${TEST_SERVER_URL}/api/health`);
      const body: AnyJson = await response.json();

      expect(response.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.service).toBe("aop");
      expect(body.db.connected).toBe(true);
    });
  });
});
