import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type CuaStatus, PairedDeviceSchema, type Project } from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "../auth/test-utils.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import type { ComputerUseService } from "./service.ts";

const JSON_HEADERS = { "content-type": "application/json" };

const NOT_INSTALLED: CuaStatus = {
  state: "not-installed",
  usable: false,
  path: null,
  version: null,
  detail: "CUA Driver is not installed on this host.",
  fix: ["install it"],
};

describe("project computer use over the API", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  const probes: { fresh?: boolean }[] = [];

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
    probes.length = 0;
    db = await createTestDb();
    const computerUse: ComputerUseService = {
      cuaStatus: async (options = {}) => {
        probes.push(options);
        return NOT_INSTALLED;
      },
      serversFor: async () => undefined,
    };
    app = createApp({ ctx: createCommandContext(db), startTimeMs: Date.now(), computerUse });
  });

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

  test("any paired device reads CUA Driver's status, and can ask for a fresh probe", async () => {
    const device = await pairDevice();

    const cached = await remote("/api/computer-use/cua", { headers: device });
    const fresh = await remote("/api/computer-use/cua?fresh=1", { headers: device });

    expect(cached.status).toBe(200);
    expect(await cached.json()).toEqual(NOT_INSTALLED);
    expect(fresh.status).toBe(200);
    expect(probes).toEqual([{ fresh: false }, { fresh: true }]);
  });
});
