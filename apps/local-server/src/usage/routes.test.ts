import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  PlanUsageResponseSchema,
  ProjectUsageSchema,
  RunUsageSchema,
  ThreadUsageSchema,
} from "@aop/common";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { createLoopbackApp, REMOTE_PEER } from "../auth/test-utils.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createUsageRepository } from "./repository.ts";
import { createUsageRoutes } from "./routes.ts";
import { entry, seedUsageWorld } from "./test-utils.ts";

describe("usage routes", () => {
  let db: Kysely<Database>;
  let app: Hono;

  beforeEach(async () => {
    db = await createTestDb();
    app = new Hono().route("/api/usage", createUsageRoutes(createCommandContext(db)));
    await seedUsageWorld(db, { thr_1: ["run_a", "run_b"], crd_1: ["run_c"] });
    const repository = createUsageRepository(db);
    await repository.record("run_a", "claude-code", [entry()], "2026-09-30T09:00:00.000Z");
    await repository.record("run_b", "claude-code", [entry()], "2026-09-30T11:00:00.000Z");
    await repository.record(
      "run_c",
      "claude-code",
      [entry({ model: "haiku" })],
      "2026-09-30T11:30:00.000Z",
    );
  });

  afterEach(async () => {
    await db.destroy();
  });

  const get = async (path: string) => {
    const response = await app.request(`/api/usage${path}`);
    return { status: response.status, body: (await response.json()) as unknown };
  };

  test("GET /runs/:id returns the run's usage", async () => {
    const { status, body } = await get("/runs/run_a");

    expect(status).toBe(200);
    expect(RunUsageSchema.parse(body)).toMatchObject({
      runId: "run_a",
      threadId: "thr_1",
      totals: { inputTokens: 10, cacheReadTokens: 4000, runs: 1 },
    });
  });

  test("GET /threads/:id sums the thread, and answers for a coordinator too", async () => {
    const thread = await get("/threads/thr_1");
    const coordinator = await get("/threads/crd_1");

    expect(ThreadUsageSchema.parse(thread.body).totals.runs).toBe(2);
    expect(ThreadUsageSchema.parse(coordinator.body).byModel[0]?.model).toBe("haiku");
  });

  test("GET /projects/:id lists the project's coordinator and threads", async () => {
    const { status, body } = await get("/projects/prj_1");

    expect(status).toBe(200);
    const usage = ProjectUsageSchema.parse(body);
    expect(usage.window).toEqual({ since: null, until: null });
    expect(usage.threads.map((thread) => [thread.threadId, thread.kind])).toEqual([
      ["thr_1", "thread"],
      ["crd_1", "coordinator"],
    ]);
  });

  test("since and until narrow the window", async () => {
    const since = encodeURIComponent("2026-09-30T10:00:00.000Z");
    const until = encodeURIComponent("2026-09-30T11:30:00.000Z");

    const { body } = await get(`/projects/prj_1?since=${since}&until=${until}`);

    const usage = ProjectUsageSchema.parse(body);
    expect(usage.totals.runs).toBe(1);
    expect(usage.window).toEqual({
      since: "2026-09-30T10:00:00.000Z",
      until: "2026-09-30T11:30:00.000Z",
    });
  });

  test.each([
    ["/threads/thr_1?since=yesterday"],
    ["/projects/prj_1?until=2026-09-30"],
    [
      `/projects/prj_1?since=${encodeURIComponent("2026-09-30T12:00:00Z")}&until=${encodeURIComponent("2026-09-30T11:00:00Z")}`,
    ],
  ])("rejects an invalid window: %s", async (path) => {
    const { status, body } = await get(path);

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Invalid usage window" });
  });

  test.each([
    ["/runs/nope", "Run not found"],
    ["/threads/nope", "Thread not found"],
    ["/projects/nope", "Project not found"],
  ])("%s is a 404", async (path, error) => {
    const { status, body } = await get(path);

    expect(status).toBe(404);
    expect(body).toEqual({ error });
  });
});

describe("usage routes behind the host's auth", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("/plan needs a device token from a remote client but not from the host itself", async () => {
    const deps = { ctx: createCommandContext(db), startTimeMs: Date.now() };

    const remote = await createApp(deps).request(
      "http://mac.tail1234.ts.net/api/usage/plan",
      {},
      REMOTE_PEER,
    );
    const local = await createLoopbackApp(deps).request("/api/usage/plan");

    expect(remote.status).toBe(401);
    expect(local.status).toBe(200);
    expect(PlanUsageResponseSchema.safeParse(await local.json()).success).toBe(true);
  });

  test.each(["/runs/x", "/threads/x", "/projects/x"])(
    "%s needs a device token from a remote client but not from the host itself",
    async (path) => {
      const deps = { ctx: createCommandContext(db), startTimeMs: Date.now() };

      const remote = await createApp(deps).request(
        `http://mac.tail1234.ts.net/api/usage${path}`,
        {},
        REMOTE_PEER,
      );
      const local = await createLoopbackApp(deps).request(`/api/usage${path}`);

      expect(remote.status).toBe(401);
      expect(local.status).toBe(404);
    },
  );
});
