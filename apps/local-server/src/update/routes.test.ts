import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PairedDeviceSchema, type UpdateStatus, UpdateStatusSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
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
};

describe("update routes", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  let applied: number;
  let applyResult: ApplyResult;

  const updates: UpdateService = {
    status: async () => STATUS,
    check: async () => ({ ...STATUS, checkedAt: "2026-10-01T11:00:00.000Z" }),
    apply: async () => {
      applied += 1;
      return applyResult;
    },
    runDueCheck: async () => {},
    runAutoApply: async () => {},
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
    applied = 0;
    applyResult = { ok: true };
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("the owner reads the status the dashboard shows", async () => {
    const res = await local("/api/updates");

    expect(res.status).toBe(200);
    expect(UpdateStatusSchema.parse(await res.json())).toEqual(STATUS);
  });

  test("a paired device sees the notice and may ask for a fresh check", async () => {
    const authorization = `Bearer ${await pairDevice()}`;

    const read = await remote("/api/updates", { headers: { authorization } });
    const check = await remote("/api/updates/check", {
      method: "POST",
      headers: { authorization },
    });

    expect(read.status).toBe(200);
    expect(((await read.json()) as UpdateStatus).available).toBe(true);
    expect(check.status).toBe(200);
    expect(((await check.json()) as UpdateStatus).checkedAt).toBe("2026-10-01T11:00:00.000Z");
  });

  test("a stranger sees nothing", async () => {
    expect((await remote("/api/updates")).status).toBe(401);
  });

  test("only the owner may start an update; a paired device gets 403 and nothing starts", async () => {
    const authorization = `Bearer ${await pairDevice()}`;

    const device = await remote("/api/updates/apply", {
      method: "POST",
      headers: { authorization },
    });
    const stranger = await remote("/api/updates/apply", { method: "POST" });

    expect(device.status).toBe(403);
    expect(await device.json()).toEqual({
      error: "Only available on the host machine",
      code: "HOST_ONLY",
    });
    expect(stranger.status).toBe(401);
    expect(applied).toBe(0);
  });

  test("the owner's apply answers 202 once the update has started", async () => {
    const res = await local("/api/updates/apply", { method: "POST" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(applied).toBe(1);
  });

  test("an apply that cannot start says why with 409", async () => {
    applyResult = { ok: false, error: "AOP is already up to date" };

    const res = await local("/api/updates/apply", { method: "POST" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "AOP is already up to date" });
  });
});
