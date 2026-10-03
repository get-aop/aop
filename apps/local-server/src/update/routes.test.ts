import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  AGENT_SESSION_HEADER,
  type ApplyUpdateRequest,
  PairedDeviceSchema,
  UpdateLogSchema,
  type UpdateStatus,
  UpdateStatusSchema,
} from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import type { HostCaller } from "../auth/host-management.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "../auth/test-utils.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import type { ApplyResult, UpdateService } from "./update-service.ts";

const STATUS: UpdateStatus = {
  enabled: true,
  supported: true,
  current: "0.9.51",
  latest: "0.10.0",
  available: true,
  releaseUrl: "https://github.com/get-aop/aop-mono/releases/tag/v0.10.0",
  checkedAt: "2026-10-01T10:00:00.000Z",
  checkError: null,
  state: "idle",
  updateError: null,
  hostName: "soulf",
  canUpdate: true,
  owner: true,
  hostManagement: "devices",
  restart: "service",
  runningTurns: [],
  queued: null,
  download: { state: "idle", version: null, error: null },
  previous: null,
  includes: { cuaDriver: null },
};

describe("update routes", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  let applied: Array<Partial<ApplyUpdateRequest> | undefined>;
  let applyResult: ApplyResult;
  let cancelled: number;
  let callers: Array<HostCaller | undefined>;

  const updates: UpdateService = {
    status: async (caller) => {
      callers.push(caller);
      return STATUS;
    },
    check: async () => ({ ...STATUS, checkedAt: "2026-10-01T11:00:00.000Z" }),
    apply: async (request) => {
      applied.push(request);
      return applyResult;
    },
    cancel: async () => {
      cancelled += 1;
    },
    runQueued: async () => {},
    runDueCheck: async () => {},
    runBackgroundDownload: async () => {},
    runAutoInstall: async () => {},
    log: async () => ({ path: "/home/m/.aop/logs/update.log", lines: ["Downloading AOP 0.10.0"] }),
    start: () => {},
    stop: () => {},
  };

  const local = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:25150${path}`, init, LOOPBACK_PEER);
  const remote = (path: string, init: RequestInit = {}) =>
    app.request(`https://mac.tail1234.ts.net${path}`, init, REMOTE_PEER);

  // A paired device, reaching the host the way a phone over the tailnet would.
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
    app = createApp({ ctx: createCommandContext(db), startTimeMs: Date.now(), updates });
    applied = [];
    applyResult = { ok: true, queued: false };
    cancelled = 0;
    callers = [];
  });

  const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const narrowToHostMachine = async () =>
    expect(
      (await local("/api/settings/host_management", { method: "PUT", ...json({ value: "owner" }) }))
        .status,
    ).toBe(200);

  afterEach(async () => {
    await db.destroy();
  });

  test("the owner reads the status the dashboard shows, as the owner", async () => {
    const res = await local("/api/updates");

    expect(res.status).toBe(200);
    expect(UpdateStatusSchema.parse(await res.json())).toEqual(STATUS);
    expect(callers).toEqual([{ kind: "owner", agent: false }]);
  });

  test("a paired device sees the notice as a device and may ask for a fresh check", async () => {
    const authorization = `Bearer ${await pairDevice()}`;

    const read = await remote("/api/updates", { headers: { authorization } });
    const check = await remote("/api/updates/check", {
      method: "POST",
      headers: { authorization },
    });

    expect(read.status).toBe(200);
    expect(callers).toEqual([{ kind: "device", agent: false }]);
    expect(check.status).toBe(200);
    expect(((await check.json()) as UpdateStatus).checkedAt).toBe("2026-10-01T11:00:00.000Z");
  });

  test("a stranger sees nothing", async () => {
    expect((await remote("/api/updates")).status).toBe(401);
    expect((await remote("/api/updates/apply", { method: "POST" })).status).toBe(401);
  });

  test("by default a paired device may update the host, queue it for later, and cancel", async () => {
    const authorization = `Bearer ${await pairDevice()}`;

    const now = await remote("/api/updates/apply", { method: "POST", headers: { authorization } });
    const later = await remote("/api/updates/apply", {
      method: "POST",
      ...json({ when: "idle" }, { authorization }),
    });
    const cancel = await remote("/api/updates/apply", {
      method: "DELETE",
      headers: { authorization },
    });

    expect(now.status).toBe(202);
    expect(await now.json()).toEqual({ ok: true, queued: false });
    expect(later.status).toBe(202);
    expect(applied).toEqual([{ when: "now" }, { when: "idle" }]);
    expect(cancel.status).toBe(204);
    expect(cancelled).toBe(1);
  });

  test("narrowed to the host machine, a device is told why and where to change it, and nothing starts", async () => {
    const authorization = `Bearer ${await pairDevice()}`;
    await narrowToHostMachine();

    for (const [path, method] of [
      ["/api/updates/apply", "POST"],
      ["/api/updates/apply", "DELETE"],
      ["/api/updates/check", "POST"],
      ["/api/agent-clis/claude-code/update", "POST"],
      ["/api/agent-clis/check", "POST"],
      ["/api/auth/pairing-codes", "POST"],
      ["/api/auth/devices", "GET"],
    ] as const) {
      const res = await remote(path, { method, headers: { authorization } });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error:
          "Only the host machine can update this host. Its owner can let paired devices do it in AOP settings › General › Who can update this host.",
        code: "HOST_ONLY",
      });
    }
    expect((await remote("/api/updates", { headers: { authorization } })).status).toBe(200);
    expect(applied).toEqual([]);
    expect(cancelled).toBe(0);
    expect((await local("/api/updates/apply", { method: "POST" })).status).toBe(202);
  });

  test("only the host machine changes who may update; a device cannot widen its own rights", async () => {
    const authorization = `Bearer ${await pairDevice()}`;
    await narrowToHostMachine();

    const single = await remote("/api/settings/host_management", {
      method: "PUT",
      ...json({ value: "devices" }, { authorization }),
    });
    const bulk = await remote("/api/settings", {
      method: "PUT",
      ...json({ settings: [{ key: "host_management", value: "devices" }] }, { authorization }),
    });

    expect(single.status).toBe(403);
    expect(bulk.status).toBe(403);
    expect(await bulk.json()).toEqual({
      error: "Only available on the host machine",
      code: "HOST_ONLY",
    });
    const stored = await local("/api/settings/host_management");
    expect(await stored.json()).toEqual({ key: "host_management", value: "owner" });
  });

  test("narrowed to the host machine, a device cannot switch on the automatic installs either", async () => {
    const authorization = `Bearer ${await pairDevice()}`;
    await narrowToHostMachine();

    for (const key of [
      "update_check",
      "update_install",
      "update_install_window",
      "update_background_download",
      "agent_cli_auto_update",
      "agent_cli_check_interval_minutes",
    ]) {
      const single = await remote(`/api/settings/${key}`, {
        method: "PUT",
        ...json({ value: "true" }, { authorization }),
      });
      const bulk = await remote("/api/settings", {
        method: "PUT",
        ...json(
          {
            settings: [
              { key: "display_name", value: "M" },
              { key, value: "true" },
            ],
          },
          {
            authorization,
          },
        ),
      });
      expect([key, single.status, bulk.status]).toEqual([key, 403, 403]);
    }
    const unrelated = await remote("/api/settings", {
      method: "PUT",
      ...json({ settings: [{ key: "display_name", value: "M" }] }, { authorization }),
    });
    expect(unrelated.status).toBe(200);
  });

  test("by default a device may change the update settings", async () => {
    const authorization = `Bearer ${await pairDevice()}`;

    const res = await remote("/api/settings", {
      method: "PUT",
      ...json({ settings: [{ key: "update_install", value: "window" }] }, { authorization }),
    });

    expect(res.status).toBe(200);
  });

  test("an agent using the aop CLI cannot update the host or change who may, even on the host machine", async () => {
    const agent = { [AGENT_SESSION_HEADER]: "session-1" };

    const apply = await local("/api/updates/apply", { method: "POST", headers: agent });
    const setting = await local("/api/settings/host_management", {
      method: "PUT",
      ...json({ value: "devices" }, agent),
    });
    const autoInstall = await local("/api/settings", {
      method: "PUT",
      ...json({ settings: [{ key: "update_install", value: "idle" }] }, agent),
    });
    const bypass = await local("/api/settings/agent_cli_skip_permissions", {
      method: "PUT",
      ...json({ value: "true" }, agent),
    });
    const status = await local("/api/updates", { headers: agent });

    for (const res of [apply, setting, autoInstall, bypass]) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("AGENT_REFUSED");
    }
    expect(applied).toEqual([]);
    expect(status.status).toBe(200);
    expect(callers).toEqual([{ kind: "owner", agent: true }]);
  });

  test("the update log is for whoever may update the host", async () => {
    const authorization = `Bearer ${await pairDevice()}`;

    const owner = await local("/api/updates/log");
    expect(owner.status).toBe(200);
    expect(UpdateLogSchema.parse(await owner.json())).toEqual({
      path: "/home/m/.aop/logs/update.log",
      lines: ["Downloading AOP 0.10.0"],
    });
    expect((await remote("/api/updates/log", { headers: { authorization } })).status).toBe(200);

    await narrowToHostMachine();
    expect((await remote("/api/updates/log", { headers: { authorization } })).status).toBe(403);
  });

  test("an apply that cannot start says why with 409, and a bad when is a 400", async () => {
    applyResult = { ok: false, error: "AOP is already up to date" };

    const res = await local("/api/updates/apply", { method: "POST" });
    const bad = await local("/api/updates/apply", { method: "POST", ...json({ when: "later" }) });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "AOP is already up to date" });
    expect(bad.status).toBe(400);
  });
});
