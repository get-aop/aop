import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type LiveViewStatus, PairedDeviceSchema, parseLiveViewMode } from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "../auth/test-utils.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { SettingKey } from "../settings/types.ts";
import { createCuaActivity } from "./cua-activity.ts";
import { createLiveViewService } from "./live-view.ts";
import { fakeCapture, manualTime } from "./test-utils.ts";

const THREAD = { id: "thr_1", projectId: "prj_1", title: "Check the login page" };
const CUA_CALL = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", id: "toolu_1", name: "mcp__cua-driver__click" }] },
});

describe("the live view over the API", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  let capture: ReturnType<typeof fakeCapture>;
  let activity: ReturnType<typeof createCuaActivity>;
  let ctx: ReturnType<typeof createCommandContext>;

  const local = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:25150${path}`, init, LOOPBACK_PEER);
  const remote = (path: string, init: RequestInit = {}) =>
    app.request(`https://mac.tail1234.ts.net${path}`, init, REMOTE_PEER);

  const pairDevice = async (): Promise<Record<string, string>> => {
    const code = (
      (await (await local("/api/auth/pairing-codes", { method: "POST" })).json()) as AnyJson
    ).code;
    const res = await remote("/api/auth/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Work Mac" }),
    });
    return { authorization: `Bearer ${PairedDeviceSchema.parse(await res.json()).token}` };
  };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    const time = manualTime();
    activity = createCuaActivity(time.now);
    capture = fakeCapture();
    const liveView = createLiveViewService({
      activity,
      startCapture: capture.start,
      readMode: async () =>
        parseLiveViewMode(await ctx.settingsRepository.get(SettingKey.LIVE_VIEW)),
      now: time.now,
      every: time.every,
    });
    app = createApp({ ctx, startTimeMs: Date.now(), liveView });
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("nothing is reachable without the session or a device token", async () => {
    expect((await remote("/api/computer-use/live")).status).toBe(401);
    expect((await remote("/api/computer-use/live/frame")).status).toBe(401);
    expect(capture.control.starts).toBe(0);
  });

  test("a paired device sees who uses CUA and gets JPEG frames, 304 while unchanged", async () => {
    const device = await pairDevice();
    activity.observeLine(THREAD, CUA_CALL);

    const status = (await (
      await remote("/api/computer-use/live", { headers: device })
    ).json()) as LiveViewStatus;
    expect(status).toMatchObject({ mode: "remote", viewer: "device", shown: true });
    expect(status.sessions.map((s) => s.title)).toEqual(["Check the login page"]);

    const starting = await remote("/api/computer-use/live/frame", { headers: device });
    expect(starting.status).toBe(503);
    expect(((await starting.json()) as AnyJson).code).toBe("LIVE_VIEW_STARTING");

    capture.control.frame = { id: 3, jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };
    const frame = await remote("/api/computer-use/live/frame", { headers: device });
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-type")).toBe("image/jpeg");
    expect(frame.headers.get("etag")).toBe('"3"');
    expect([...new Uint8Array(await frame.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 0xd9]);

    const same = await remote("/api/computer-use/live/frame", {
      headers: { ...device, "if-none-match": '"3"' },
    });
    expect(same.status).toBe(304);
  });

  test("by default the person at the host gets no frames; `always` changes that", async () => {
    activity.observeLine(THREAD, CUA_CALL);

    const refused = await local("/api/computer-use/live/frame");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as AnyJson).code).toBe("LIVE_VIEW_OFF");

    const saved = await local("/api/settings/live_view", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "always" }),
    });
    expect(saved.status).toBe(200);
    expect((await local("/api/computer-use/live/frame")).status).toBe(503);
    expect(capture.control.starts).toBe(1);
  });

  test("the setting takes only off, remote or always", async () => {
    const res = await local("/api/settings/live_view", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "sometimes" }),
    });
    expect(res.status).toBe(400);
  });
});
