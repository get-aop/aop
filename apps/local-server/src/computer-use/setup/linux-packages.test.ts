import { describe, expect, test } from "bun:test";
import { inspectLinux, sudoCommandFor } from "./linux-packages.ts";
import { fakeMachine, readyLinux } from "./test-utils.ts";

describe("what a Linux host lacks for computer use", () => {
  test("a host with everything lacks nothing and needs no sudo", async () => {
    const result = await inspectLinux(readyLinux().sys, { virtualDisplay: true });

    expect(result.missing).toEqual([]);
    expect(result.sudoCommand).toBeNull();
    expect(result.browser).toBe("/opt/google/chrome/google-chrome");
  });

  test("a bare Ubuntu gets ONE apt command for the display, libraries, AT-SPI, ffmpeg and Google Chrome", async () => {
    const { sys } = fakeMachine({ libraries: ["libX11.so.6", "libxcb.so.1"] });

    const result = await inspectLinux(sys, { virtualDisplay: true });

    expect(result.missing.map((item) => item.id)).toEqual([
      "xvfb",
      "openbox",
      "libXi.so.6",
      "libXext.so.6",
      "libxkbcommon.so.0",
      "at-spi",
      "browser",
      "ffmpeg",
    ]);
    expect(result.sudoCommand).toBe(
      "sudo sh -c 'export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y --no-install-recommends xvfb openbox libxi6 libxext6 libxkbcommon0 at-spi2-core ffmpeg && curl -fsSL -o /tmp/aop-google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt-get install -y /tmp/aop-google-chrome.deb && rm -f /tmp/aop-google-chrome.deb'",
    );
  });

  test("the chromium snap does not count: CUA Driver launches only root-owned browsers at its paths", async () => {
    const { sys } = readyLinux({
      paths: ["/usr/libexec/at-spi-bus-launcher", "/opt/google/chrome/google-chrome"],
      rootOwned: [],
    });

    const result = await inspectLinux(sys, { virtualDisplay: true });

    expect(result.browser).toBeNull();
    expect(result.missing.map((item) => item.id)).toEqual(["browser"]);
  });

  test("using the person's desktop needs no Xvfb or openbox", async () => {
    const { sys } = readyLinux({ commands: ["ldconfig", "apt-get", "ffmpeg"] });

    expect((await inspectLinux(sys, { virtualDisplay: false })).missing).toEqual([]);
    expect((await inspectLinux(sys, { virtualDisplay: true })).missing.map((i) => i.id)).toEqual([
      "xvfb",
      "openbox",
    ]);
  });

  test("ffmpeg alone is optional: the live view needs it, computer use does not", async () => {
    const { sys } = readyLinux({ commands: ["ldconfig", "apt-get", "Xvfb", "openbox"] });

    const result = await inspectLinux(sys, { virtualDisplay: true });

    expect(result.missing).toMatchObject([{ id: "ffmpeg", optional: true }]);
    expect(result.sudoCommand).toBe(
      "sudo sh -c 'export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y --no-install-recommends ffmpeg'",
    );
  });

  test("dnf hosts get a dnf command; a host with neither gets no command", async () => {
    const dnf = fakeMachine({ commands: ["ldconfig", "dnf"] });
    const neither = fakeMachine({ commands: ["ldconfig"] });

    expect((await inspectLinux(dnf.sys, { virtualDisplay: true })).sudoCommand).toBe(
      "sudo sh -c 'dnf install -y xorg-x11-server-Xvfb openbox at-spi2-core ffmpeg && dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm'",
    );
    expect((await inspectLinux(neither.sys, { virtualDisplay: true })).sudoCommand).toBeNull();
  });

  test("Google Chrome has no arm64 Linux build: no command is offered for it", async () => {
    const { sys } = fakeMachine({ arch: "arm64" });

    expect((await inspectLinux(sys, { virtualDisplay: true })).sudoCommand).toBeNull();
  });

  test("extra root steps (linger) ride along, or stand alone when no package is missing", () => {
    const { sys } = readyLinux();

    expect(sudoCommandFor(sys, [], ["loginctl enable-linger ada"])).toBe(
      "sudo sh -c 'loginctl enable-linger ada'",
    );
  });
});
