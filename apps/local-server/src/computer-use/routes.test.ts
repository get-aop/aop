import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type CuaStatus, PairedDeviceSchema, type Project } from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "../auth/test-utils.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import type { CuaProbeDeps } from "./cua-driver.ts";
import { createDriverClient } from "./driver-client.ts";
import { createDriverPool } from "./driver-pool.ts";
import { createCuaGate } from "./mcp-gate.ts";
import { createComputerUseService } from "./service.ts";
import {
  A,
  B,
  CUA_PATH,
  type FakeCuaOptions,
  fakeCua,
  fakeDriver,
  leaseClock,
} from "./test-utils.ts";

const JSON_HEADERS = { "content-type": "application/json" };

describe("project computer use over the API", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  // The host's driver as the probe finds it; each test sets what it needs.
  let host: { options: FakeCuaOptions; overrides: Partial<CuaProbeDeps> };
  let probes = 0;

  // The host owner at the machine, and a paired device that reached it over the tailnet.
  const local = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:25150${path}`, init, LOOPBACK_PEER);
  const remote = (path: string, init: RequestInit = {}) =>
    app.request(`https://mac.tail1234.ts.net${path}`, init, REMOTE_PEER);
  const send = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
    method,
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  });

  const pairDevice = async (): Promise<Record<string, string>> => {
    const code = (
      (await (await local("/api/auth/pairing-codes", { method: "POST" })).json()) as AnyJson
    ).code;
    const res = await remote("/api/auth/pair", send("POST", { code, name: "Work Mac" }));
    return { authorization: `Bearer ${PairedDeviceSchema.parse(await res.json()).token}` };
  };

  const createProject = async (): Promise<Project> => {
    const res = await local("/api/projects", send("POST", { name: "Checkout" }));
    expect(res.status).toBe(201);
    return ((await res.json()) as { project: Project }).project;
  };

  const readProject = async (id: string): Promise<Project> =>
    ((await (await local(`/api/projects/${id}`)).json()) as { project: Project }).project;

  beforeEach(async () => {
    host = { options: {}, overrides: {} };
    probes = 0;
    db = await createTestDb();
    // The real service and probe over a fake `cua-driver`, so the route answers what a host would.
    const computerUse = createComputerUseService({
      ...fakeCua(),
      locate: () => (host.overrides.locate ? host.overrides.locate() : CUA_PATH),
      run: (argv, timeoutMs) => {
        if (argv[1] === "--version") probes += 1;
        return fakeCua(host.options).run(argv, timeoutMs);
      },
    });
    app = createApp({ ctx: createCommandContext(db), startTimeMs: Date.now(), computerUse });
  });

  const readCua = async (path = "/api/computer-use/cua", init: RequestInit = {}) => {
    const res = await remote(path, init);
    expect(res.status).toBe(200);
    return (await res.json()) as CuaStatus;
  };

  afterEach(async () => {
    await db.destroy();
  });

  test("a new project leaves computer use to the model", async () => {
    const project = await createProject();

    expect(project.computerUse).toBe("model-default");
    expect((await readProject(project.id)).computerUse).toBe("model-default");
  });

  test("the host owner chooses CUA, and back", async () => {
    const project = await createProject();

    const chosen = await local(
      `/api/projects/${project.id}/computer-use`,
      send("PUT", { computerUse: "cua" }),
    );

    expect(chosen.status).toBe(200);
    expect(((await chosen.json()) as { project: Project }).project.computerUse).toBe("cua");
    expect((await readProject(project.id)).computerUse).toBe("cua");

    await local(
      `/api/projects/${project.id}/computer-use`,
      send("PUT", { computerUse: "model-default" }),
    );
    expect((await readProject(project.id)).computerUse).toBe("model-default");
  });

  test("a paired device cannot change it, though it may read the project", async () => {
    const project = await createProject();
    const device = await pairDevice();

    const res = await remote(
      `/api/projects/${project.id}/computer-use`,
      send("PUT", { computerUse: "cua" }, device),
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as AnyJson).code).toBe("HOST_ONLY");
    const read = await remote(`/api/projects/${project.id}`, { headers: device });
    expect(((await read.json()) as { project: Project }).project.computerUse).toBe("model-default");
  });

  test("a settings patch cannot change it either", async () => {
    const project = await createProject();

    await local(`/api/projects/${project.id}`, send("PATCH", { goal: "Ship", computerUse: "cua" }));

    expect((await readProject(project.id)).computerUse).toBe("model-default");
  });

  test.each(["codex", "claude"])("refuses %s, which is not available yet", async (option) => {
    const project = await createProject();

    const res = await local(
      `/api/projects/${project.id}/computer-use`,
      send("PUT", { computerUse: option }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "COMPUTER_USE_UNAVAILABLE",
      error: expect.stringContaining("not available yet"),
    });
    expect((await readProject(project.id)).computerUse).toBe("model-default");
  });

  test("answers 400 for an option it does not know, and 404 for an unknown project", async () => {
    const project = await createProject();

    const unknown = await local(
      `/api/projects/${project.id}/computer-use`,
      send("PUT", { computerUse: "selenium" }),
    );
    const missing = await local(
      "/api/projects/proj_missing/computer-use",
      send("PUT", { computerUse: "cua" }),
    );

    expect(unknown.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  describe("GET /api/computer-use/cua, the host's own CUA Driver", () => {
    let device: Record<string, string>;
    const read = (path?: string) => readCua(path, { headers: device });

    beforeEach(async () => {
      device = await pairDevice();
    });

    test("ready, with its version and the host's name, to any paired device", async () => {
      expect(await read()).toMatchObject({
        status: "ready",
        reason: "ready",
        version: "0.32.0",
        host: { name: "Studio Mac", platform: "darwin" },
      });
    });

    test("not installed", async () => {
      host.overrides.locate = () => null;

      expect(await read()).toMatchObject({
        status: "not-installed",
        reason: "not-installed",
        detail: "CUA Driver is not installed on this host.",
        version: null,
      });
    });

    test("installed but not ready, with the reason and the version", async () => {
      host.options.permissions = JSON.stringify({ accessibility: false, screen_recording: true });

      expect(await read()).toMatchObject({
        status: "not-ready",
        reason: "missing-permissions",
        detail: "CUA Driver lacks the macOS Accessibility permission.",
        version: "0.32.0",
      });
    });

    test("reuses its last answer for a few seconds, and checks again on demand", async () => {
      expect((await read()).status).toBe("ready");
      host.options.permissions = JSON.stringify({ daemon_running: false });

      expect((await read()).status).toBe("ready");
      expect(probes).toBe(1);
      expect(await read("/api/computer-use/cua?fresh=1")).toMatchObject({
        status: "not-ready",
        reason: "not-running",
      });
      expect(probes).toBe(2);
    });
  });
});

describe("the computer-use lease over the API", () => {
  test("any paired device reads who holds the screen and who waits", async () => {
    const db = await createTestDb();
    const { lease } = leaseClock();
    const driver = fakeDriver();
    const pool = createDriverPool(async () => createDriverClient(driver.spawn));
    const gate = createCuaGate({ lease, pool });
    const app = createApp({
      ctx: createCommandContext(db),
      startTimeMs: Date.now(),
      cua: { lease, pool, gate },
    });
    lease.tryAcquire(A);
    void lease.acquire(B, { maxWaitMs: 60_000 });
    const local = (path: string, init: RequestInit = {}) =>
      app.request(`http://127.0.0.1:25150${path}`, init, LOOPBACK_PEER);
    const code = (
      (await (await local("/api/auth/pairing-codes", { method: "POST" })).json()) as AnyJson
    ).code;
    const paired = await app.request(
      "https://mac.tail1234.ts.net/api/auth/pair",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ code, name: "Work Mac" }) },
      REMOTE_PEER,
    );
    const token = PairedDeviceSchema.parse(await paired.json()).token;

    const res = await app.request(
      "https://mac.tail1234.ts.net/api/computer-use/lease",
      { headers: { authorization: `Bearer ${token}` } },
      REMOTE_PEER,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      holder: { kind: "thread", threadId: A.id, title: A.title },
      queue: [{ threadId: B.id, position: 1 }],
      idleReleaseMs: 180_000,
    });
    lease.stop();
  });
});
