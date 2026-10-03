import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type AgentClisResponse, AgentClisResponseSchema, PairedDeviceSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "../auth/test-utils.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import type { AgentCliService, UpdateRequestResult } from "./service.ts";

const RESPONSE: AgentClisResponse = {
  clis: [
    {
      provider: "claude-code",
      label: "Claude Code",
      command: "claude",
      installed: true,
      path: "/Users/me/.local/bin/claude",
      realPath: "/Users/me/.local/share/claude/versions/2.1.285",
      version: "2.1.285",
      installMethod: "native",
      updateCommand: "claude update",
      latest: "2.1.286",
      channel: "latest",
      updateAvailable: true,
      checkedAt: "2026-10-01T10:00:00.000Z",
      checkError: null,
      activeRuns: { count: 0, versions: [] },
      lastRunVersion: "2.1.285",
      update: {
        state: "idle",
        trigger: null,
        startedAt: null,
        finishedAt: null,
        fromVersion: null,
        toVersion: null,
        deferredFor: 0,
        error: null,
        manualCommand: null,
        output: null,
      },
    },
  ],
  checkIntervalMinutes: 60,
  autoUpdate: false,
  skipPermissions: { enabled: false, blockedReason: null },
};

describe("agent CLI routes", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  let requested: string[];
  let result: UpdateRequestResult;

  const clis: AgentCliService = {
    status: async () => RESPONSE,
    check: async () => RESPONSE,
    update: async (provider) => {
      requested.push(provider);
      return result;
    },
    start: () => {},
    stop: () => {},
  };

  const local = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:25150${path}`, init, LOOPBACK_PEER);
  const remote = (path: string, init: RequestInit = {}) =>
    app.request(`https://mac.tail1234.ts.net${path}`, init, REMOTE_PEER);

  const pairDevice = async (): Promise<string> => {
    const issued = await local("/api/auth/pairing-codes", { method: "POST" });
    const { code } = (await issued.json()) as { code: string };
    const paired = await remote("/api/auth/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Phone" }),
    });
    return PairedDeviceSchema.parse(await paired.json()).token;
  };

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp({ ctx: createCommandContext(db), startTimeMs: Date.now(), agentClis: clis });
    requested = [];
    result = { ok: true };
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("lists the CLIs in the shared schema", async () => {
    const res = await local("/api/agent-clis");
    expect(res.status).toBe(200);
    expect(AgentClisResponseSchema.parse(await res.json())).toEqual(RESPONSE);
  });

  test("a paired device reads, checks and updates by default, and only reads once the owner narrows it to the host machine", async () => {
    const authorization = `Bearer ${await pairDevice()}`;
    const check = () =>
      remote("/api/agent-clis/check", { method: "POST", headers: { authorization } });
    const update = () =>
      remote("/api/agent-clis/claude-code/update", { method: "POST", headers: { authorization } });

    expect((await check()).status).toBe(200);
    expect((await update()).status).toBe(202);
    expect(requested).toEqual(["claude-code"]);

    await local("/api/settings/host_management", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "owner" }),
    });
    expect((await remote("/api/agent-clis", { headers: { authorization } })).status).toBe(200);
    expect((await check()).status).toBe(403);
    expect((await update()).status).toBe(403);
    expect(requested).toEqual(["claude-code"]);
  });

  test("the owner's update answers 202 once it has started", async () => {
    const res = await local("/api/agent-clis/claude-code/update", { method: "POST" });
    expect(res.status).toBe(202);
    expect(requested).toEqual(["claude-code"]);
  });

  test("an update that cannot start says why, with the command to run by hand", async () => {
    result = {
      ok: false,
      status: 409,
      error: "An update of Claude Code is already running",
      manualCommand: null,
    };
    const busy = await local("/api/agent-clis/claude-code/update", { method: "POST" });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({
      error: "An update of Claude Code is already running",
      manualCommand: null,
    });

    result = { ok: false, status: 422, error: "AOP cannot tell", manualCommand: "claude update" };
    const unknown = await local("/api/agent-clis/claude-code/update", { method: "POST" });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toEqual({
      error: "AOP cannot tell",
      manualCommand: "claude update",
    });
  });
});
