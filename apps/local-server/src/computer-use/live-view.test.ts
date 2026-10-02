import { describe, expect, test } from "bun:test";
import type { LiveViewMode } from "@aop/common";
import { createCuaActivity, LINGER_MS } from "./cua-activity.ts";
import { createLiveViewService, RETRY_MS, VIEWER_TTL_MS } from "./live-view.ts";
import { fakeCapture, manualTime } from "./test-utils.ts";

const THREAD = { id: "thr_1", projectId: "prj_1", title: "Check the login page" };
const cuaCall = (name: string) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "toolu_1", name: `mcp__cua-driver__${name}` }] },
  });

const setup = (mode: LiveViewMode = "remote") => {
  const time = manualTime();
  const activity = createCuaActivity(time.now);
  const capture = fakeCapture();
  const settings = { mode };
  const service = createLiveViewService({
    activity,
    startCapture: capture.start,
    readMode: async () => settings.mode,
    now: time.now,
    every: time.every,
  });
  const startCua = () => activity.observeLine(THREAD, cuaCall("click"));
  return { time, activity, capture, settings, service, startCua };
};

describe("the live view's capture", () => {
  test("does not start while no CUA session is active, even with a viewer", async () => {
    const { service, capture } = setup();

    const answer = await service.frame("device");

    expect(answer).toEqual({
      kind: "refused",
      status: 404,
      code: "LIVE_VIEW_IDLE",
      error: "No thread is using computer use.",
    });
    expect(capture.control.starts).toBe(0);
  });

  test("starts on the first viewer's frame request, not on a status read", async () => {
    const { service, capture, startCua } = setup();
    startCua();

    const status = await service.status("device");
    expect(status.sessions.map((s) => s.threadId)).toEqual(["thr_1"]);
    expect(status.capture).toEqual({ state: "idle", detail: null });
    expect(capture.control.starts).toBe(0);

    expect(await service.frame("device")).toMatchObject({ code: "LIVE_VIEW_STARTING" });
    expect(capture.control.starts).toBe(1);
    expect((await service.status("device")).capture.state).toBe("starting");

    capture.control.frame = { id: 1, jpeg: new Uint8Array([1]) };
    expect(await service.frame("device")).toMatchObject({ kind: "frame", frame: { id: 1 } });
    expect((await service.status("device")).capture.state).toBe("live");
    // A second viewer shares the one capture.
    await service.frame("device");
    expect(capture.control.starts).toBe(1);
  });

  test("stops a few seconds after the last viewer stops asking", async () => {
    const { service, capture, startCua, time } = setup();
    startCua();
    await service.frame("device");

    time.advance(VIEWER_TTL_MS - 1_000);
    await service.frame("device");
    time.advance(VIEWER_TTL_MS - 1_000);
    expect(capture.control.running).toBe(true);

    time.advance(2_000);
    expect(capture.control.running).toBe(false);
    expect(time.tickers()).toBe(0);
    expect((await service.status("device")).capture.state).toBe("idle");
  });

  test("stops as soon as the CUA session ends, and serves its last frame while it lingers", async () => {
    const { service, capture, activity, time, startCua } = setup();
    startCua();
    await service.frame("device");
    capture.control.frame = { id: 7, jpeg: new Uint8Array([7]) };

    activity.observeLine(THREAD, cuaCall("end_session"));
    time.advance(1_000);

    expect(capture.control.running).toBe(false);
    expect(await service.frame("device")).toMatchObject({ kind: "frame", frame: { id: 7 } });
    expect(capture.control.starts).toBe(1);

    time.advance(LINGER_MS);
    expect(await service.frame("device")).toMatchObject({ code: "LIVE_VIEW_IDLE" });
  });

  test("says why when the host cannot capture (no ffmpeg), and retries only after a while", async () => {
    const { service, capture, startCua, time } = setup();
    capture.control.unavailable = "ffmpeg is not installed on the host.";
    startCua();

    expect(await service.frame("device")).toEqual({
      kind: "refused",
      status: 503,
      code: "LIVE_VIEW_UNAVAILABLE",
      error: "Live view unavailable: ffmpeg is not installed on the host.",
    });
    expect((await service.status("device")).capture).toEqual({
      state: "unavailable",
      detail: "ffmpeg is not installed on the host.",
    });

    capture.control.unavailable = null;
    await service.frame("device");
    expect(capture.control.starts).toBe(0);

    time.advance(RETRY_MS);
    startCua();
    await service.frame("device");
    expect(capture.control.starts).toBe(1);
  });

  test("a capture whose ffmpeg died is reported unavailable and stopped", async () => {
    const { service, capture, startCua, time } = setup();
    startCua();
    await service.frame("device");

    capture.control.failure = "the capture stopped (ffmpeg exited with 1).";
    time.advance(1_000);

    expect(capture.control.running).toBe(false);
    expect(await service.frame("device")).toMatchObject({
      code: "LIVE_VIEW_UNAVAILABLE",
      error: "Live view unavailable: the capture stopped (ffmpeg exited with 1).",
    });
  });
});

describe("who gets the live view", () => {
  test("by default, a paired device does and the person at the host does not", async () => {
    const { service, capture, startCua } = setup("remote");
    startCua();

    expect(await service.frame("owner")).toMatchObject({ status: 403, code: "LIVE_VIEW_OFF" });
    expect(capture.control.starts).toBe(0);
    expect(await service.status("owner")).toMatchObject({ viewer: "owner", shown: false });
    expect(await service.status("device")).toMatchObject({ viewer: "device", shown: true });
  });

  test("off refuses everyone; always shows everyone", async () => {
    const { service, settings, startCua } = setup("off");
    startCua();
    expect(await service.frame("device")).toMatchObject({ code: "LIVE_VIEW_OFF" });
    expect((await service.status("device")).shown).toBe(false);

    settings.mode = "always";
    expect((await service.status("owner")).shown).toBe(true);
    expect(await service.frame("owner")).toMatchObject({ code: "LIVE_VIEW_STARTING" });
  });
});
