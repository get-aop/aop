import { describe, expect, test } from "bun:test";
import {
  detectDesktop,
  ensureVirtualDisplay,
  OPENBOX_UNIT,
  virtualDisplayUnits,
  XVFB_UNIT,
} from "./display.ts";
import { HOME, readyLinux } from "./test-utils.ts";

const UNITS = `${HOME}/.config/systemd/user`;

describe("the virtual display", () => {
  test("its units are the ones the soulf host has run since 2026-10-02, so setup there changes nothing", () => {
    const units = virtualDisplayUnits(":99", {
      xvfb: "/usr/bin/Xvfb",
      openbox: "/usr/bin/openbox",
    });

    expect(units[XVFB_UNIT]).toBe(`[Unit]
Description=Virtual display :99 for computer use (CUA)

[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`);
    expect(units[OPENBOX_UNIT]).toContain("Environment=DISPLAY=:99");
    expect(units[OPENBOX_UNIT]).toContain("[ -S /tmp/.X11-unix/X99 ]");
  });

  test("first run writes, reloads, enables and starts; a second run writes nothing and restarts nothing", async () => {
    const machine = readyLinux();

    const first = await ensureVirtualDisplay(machine.sys, ":99");
    const runsAfterFirst = machine.runs.length;
    const second = await ensureVirtualDisplay(machine.sys, ":99");

    expect(first).toEqual({ written: [XVFB_UNIT, OPENBOX_UNIT], started: true, problem: null });
    expect(machine.runs.slice(0, runsAfterFirst)).toEqual([
      "systemctl --user daemon-reload",
      `systemctl --user enable ${XVFB_UNIT} ${OPENBOX_UNIT}`,
      `systemctl --user restart ${XVFB_UNIT} ${OPENBOX_UNIT}`,
    ]);
    expect(second).toEqual({ written: [], started: true, problem: null });
    expect(machine.runs.slice(runsAfterFirst)).toEqual([
      `systemctl --user enable ${XVFB_UNIT} ${OPENBOX_UNIT}`,
      `systemctl --user start ${XVFB_UNIT} ${OPENBOX_UNIT}`,
    ]);
    expect(machine.files.has(`${UNITS}/${XVFB_UNIT}`)).toBe(true);
  });

  test("without Xvfb it writes and starts nothing and says why", async () => {
    const machine = readyLinux({ commands: ["systemctl", "openbox"] });

    const result = await ensureVirtualDisplay(machine.sys, ":99");

    expect(result.started).toBe(false);
    expect(result.problem).toContain("Xvfb and openbox are not installed yet");
    expect(machine.runs).toEqual([]);
  });
});

describe("the person's desktop", () => {
  test("an X socket other than the virtual display's is a desktop", () => {
    const { sys } = readyLinux({ paths: ["/tmp/.X11-unix/X0", "/tmp/.X11-unix/X99"] });

    expect(detectDesktop(sys, ":99")).toEqual({ kind: "x11", display: ":0" });
  });

  test("a Wayland session counts, with its Xwayland display when there is one", () => {
    const { sys } = readyLinux({
      paths: ["/tmp/.X11-unix/X1", "/run/user/1000/wayland-0"],
      env: { XDG_RUNTIME_DIR: "/run/user/1000" },
    });

    expect(detectDesktop(sys, ":99")).toEqual({ kind: "wayland", display: ":1" });
  });

  test("a headless host with only the virtual display has none", () => {
    expect(detectDesktop(readyLinux().sys, ":99")).toBeNull();
  });
});
