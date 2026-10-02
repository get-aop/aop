import { describe, expect, test } from "bun:test";
import { createScreenCapture, ffmpegArgv, type ScreenCaptureDeps } from "./screen-capture.ts";
import { fakeCaptureProcess } from "./test-utils.ts";

const linuxHost = (overrides: Partial<ScreenCaptureDeps> = {}) => {
  const ffmpeg = fakeCaptureProcess();
  const spawned: string[][] = [];
  const deps: ScreenCaptureDeps = {
    platform: "linux",
    display: () => ":99",
    displayRunning: () => true,
    locateFfmpeg: () => "/usr/bin/ffmpeg",
    spawn: (argv) => {
      spawned.push(argv);
      return ffmpeg.process;
    },
    ...overrides,
  };
  return { start: createScreenCapture(deps), ffmpeg, spawned };
};

const settle = () => Bun.sleep(5);

describe("createScreenCapture", () => {
  test("says why it cannot capture: another system, no display, a display that is down, no ffmpeg", () => {
    expect(linuxHost({ displayRunning: (display) => display !== ":99" }).start()).toEqual({
      unavailable: "the X display :99 is not running.",
    });
    expect(linuxHost({ platform: "darwin" }).start()).toEqual({
      unavailable: "capturing the screen is not supported on macOS yet.",
    });
    expect(linuxHost({ display: () => undefined }).start()).toEqual({
      unavailable: "the host has no X display (DISPLAY is not set).",
    });
    expect(linuxHost({ locateFfmpeg: () => null }).start()).toEqual({
      unavailable: "ffmpeg is not installed on the host.",
    });
  });

  test("grabs the host's X display with ffmpeg, capped in rate and width", () => {
    const host = linuxHost();
    host.start();
    expect(host.spawned).toEqual([ffmpegArgv("/usr/bin/ffmpeg", ":99")]);
    const argv = host.spawned[0] ?? [];
    expect(argv.slice(argv.indexOf("-f"), argv.indexOf("-f") + 6)).toEqual([
      "-f",
      "x11grab",
      "-framerate",
      "4",
      "-i",
      ":99",
    ]);
    expect(argv).toContain("scale='min(1280,iw)':-2");
  });

  test("keeps the latest frame, and its id only moves when the picture changes", async () => {
    const host = linuxHost();
    const capture = host.start();
    if ("unavailable" in capture) throw new Error("expected a capture");
    expect(capture.latest()).toBeNull();

    host.ffmpeg.frame([0xff, 0xd8, 1, 0xff, 0xd9]);
    await settle();
    expect(capture.latest()?.id).toBe(1);

    host.ffmpeg.frame([0xff, 0xd8, 1, 0xff, 0xd9]);
    await settle();
    expect(capture.latest()?.id).toBe(1);

    host.ffmpeg.frame([0xff, 0xd8, 2, 0xff, 0xd9]);
    await settle();
    expect(capture.latest()?.id).toBe(2);
    expect([...(capture.latest()?.jpeg ?? [])]).toEqual([0xff, 0xd8, 2, 0xff, 0xd9]);
  });

  test("an ffmpeg that exits reports why, with the last line it printed", async () => {
    const host = linuxHost();
    const capture = host.start();
    if ("unavailable" in capture) throw new Error("expected a capture");

    host.ffmpeg.fail("[x11grab] Cannot open display :99, error 1.");
    await settle();

    expect(capture.failure()).toBe(
      "the capture stopped (ffmpeg exited with 1: [x11grab] Cannot open display :99, error 1.).",
    );
  });

  test("stopping kills ffmpeg and is no failure", async () => {
    const host = linuxHost();
    const capture = host.start();
    if ("unavailable" in capture) throw new Error("expected a capture");

    capture.stop();
    await settle();

    expect(host.ffmpeg.state.killed).toBe(true);
    expect(capture.failure()).toBeNull();
  });
});
