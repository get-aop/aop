import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AGENT_SESSION_HEADER, EMPTY_CUA_LEASE, HostSetupSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "../auth/test-utils.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createHostSetupService } from "./service.ts";
import { cuaNoScreen, cuaStatus, FACTS, readyProbes } from "./test-utils.ts";

describe("host setup routes", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  let screenUp: boolean;
  let fixes: number;

  const local = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:25650${path}`, init, LOOPBACK_PEER);
  const remote = (path: string, init: RequestInit = {}) =>
    app.request(`https://soulf.tailffbdec.ts.net:25650${path}`, init, REMOTE_PEER);
  const pairDevice = async (): Promise<string> => {
    const { code } = (await (
      await local("/api/auth/pairing-codes", { method: "POST" })
    ).json()) as AnyJson;
    const res = await remote("/api/auth/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Work Mac" }),
    });
    return ((await res.json()) as AnyJson).token;
  };

  beforeEach(async () => {
    db = await createTestDb();
    screenUp = false;
    fixes = 0;
    const hostSetup = createHostSetupService({
      probes: readyProbes({
        computerUse: async () => ({
          status: screenUp ? cuaStatus() : cuaNoScreen(),
          lease: EMPTY_CUA_LEASE,
          wanted: true,
        }),
        setupComputerUse: async () => {
          fixes += 1;
          screenUp = true;
          return 0;
        },
      }),
      facts: FACTS,
    });
    app = createApp({ ctx: createCommandContext(db), startTimeMs: Date.now(), hostSetup });
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("GET /api/host/setup answers the checklist to the owner and to any paired device", async () => {
    const token = await pairDevice();

    const asOwner = await local("/api/host/setup");
    const asDevice = await remote("/api/host/setup", {
      headers: { authorization: `Bearer ${token}` },
    });
    const stranger = await remote("/api/host/setup");

    expect(asOwner.status).toBe(200);
    const setup = HostSetupSchema.parse(await asOwner.json());
    expect({ ready: setup.ready, total: setup.total }).toEqual({ ready: 5, total: 6 });
    expect(asDevice.status).toBe(200);
    expect(stranger.status).toBe(401);
  });

  test("POST /api/host/setup/:id/fix runs the fix and answers the fresh checklist", async () => {
    const res = await local("/api/host/setup/computer-use/fix", { method: "POST" });

    expect(res.status).toBe(200);
    const setup = HostSetupSchema.parse(await res.json());
    expect(fixes).toBe(1);
    expect(setup.checks.find((check) => check.id === "computer-use")?.state).toBe("ok");
    expect(setup.ready).toBe(6);
  });

  test("a check without a fix is a 409, an unknown one a 404", async () => {
    const noFix = await local("/api/host/setup/github/fix", { method: "POST" });
    const unknown = await local("/api/host/setup/nope/fix", { method: "POST" });

    expect(noFix.status).toBe(409);
    expect(await noFix.json()).toMatchObject({ code: "NO_FIX" });
    expect(unknown.status).toBe(404);
    expect(fixes).toBe(0);
  });

  test("a fix is for whoever may manage the host, and never for an agent", async () => {
    const token = await pairDevice();
    const fromDevice = () =>
      remote("/api/host/setup/computer-use/fix", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });

    const agent = await local("/api/host/setup/computer-use/fix", {
      method: "POST",
      headers: { [AGENT_SESSION_HEADER]: "session-1" },
    });
    expect(agent.status).toBe(403);
    expect(fixes).toBe(0);

    await local("/api/settings/host_management", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "owner" }),
    });
    const narrowed = await fromDevice();
    expect(narrowed.status).toBe(403);
    expect(fixes).toBe(0);

    await local("/api/settings/host_management", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "devices" }),
    });
    expect((await fromDevice()).status).toBe(200);
    expect(fixes).toBe(1);
  });
});
