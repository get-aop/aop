import { describe, expect, test } from "bun:test";
import type { CuaStatus } from "@aop/common";
import { runComputerUseSetup, runComputerUseStatus, type SetupIO } from "./run-setup.ts";
import { type FakeMachine, fakeMachine, HOME, readyLinux } from "./test-utils.ts";

const CONFIG = `${HOME}/.aop/computer-use.json`;

const io = (answers: boolean[] | null = null): SetupIO & { lines: string[]; asked: string[] } => {
  const lines: string[] = [];
  const asked: string[] = [];
  return {
    lines,
    asked,
    print: (line) => lines.push(line),
    interactive: answers !== null,
    confirm: async (question, fallback) => {
      asked.push(question);
      return answers?.shift() ?? fallback;
    },
  };
};

const status = (ready: boolean): CuaStatus => ({
  status: ready ? "ready" : "not-ready",
  reason: ready ? "ready" : "no-display",
  detail: ready ? "CUA Driver 0.32.0 is ready on this host." : "CUA Driver has no screen to drive.",
  path: `${HOME}/.local/bin/cua-driver`,
  version: "0.32.0",
  latestVersion: null,
  checks: [],
  fix: { command: null, sudoCommand: null, missing: [], pinnedVersion: "0.32.0" },
  host: { name: "box", platform: "linux" },
  checkedAt: "2026-10-03T12:00:00.000Z",
});

const setup = (machine: FakeMachine, terminal = io(), ready = true, options = {}) =>
  runComputerUseSetup(
    { configPath: CONFIG, ...options },
    { sys: machine.sys, io: terminal, probe: async () => status(ready) },
  );

const installerRuns = (machine: FakeMachine) =>
  machine.runs.filter((run) => run.includes("cua.ai/driver/install.sh"));

describe("aop computer-use setup on Linux", () => {
  test("a fresh host gets the pinned driver and a virtual display; the sudo command is printed, not run, without a terminal", async () => {
    const machine = fakeMachine({
      driver: null,
      commands: ["systemctl", "loginctl", "ldconfig", "apt-get", "Xvfb", "openbox"],
    });
    const terminal = io();

    const code = await setup(machine, terminal, false);

    expect(code).toBe(2);
    expect(installerRuns(machine)).toHaveLength(1);
    expect(machine.installedVersion.value).toBe("0.32.0");
    expect(terminal.lines).toContain(`✓ CUA Driver 0.32.0 at ${HOME}/.local/bin/cua-driver`);
    expect(
      terminal.lines.some((line) =>
        line.startsWith("  sudo sh -c 'export DEBIAN_FRONTEND=noninteractive && apt-get update"),
      ),
    ).toBe(true);
    expect(terminal.lines).toContain(
      "Run that once as root (it asks for your password), then run setup again.",
    );
    expect(machine.runs.some((run) => run.startsWith("/bin/sh -c sudo"))).toBe(false);
    expect(terminal.asked).toEqual([]);
    expect(JSON.parse(machine.files.get(CONFIG) ?? "{}")).toEqual({
      screen: "virtual",
      display: ":99",
    });
  });

  test("running it again on a ready host changes nothing: no installer, no unit written, no sudo", async () => {
    const machine = readyLinux();
    await setup(machine);
    const writes = machine.files.size;
    machine.runs.length = 0;

    const code = await setup(machine);

    expect(code).toBe(0);
    expect(installerRuns(machine)).toEqual([]);
    expect(machine.files.size).toBe(writes);
    expect(
      machine.runs.filter((run) => run.includes("daemon-reload") || run.includes("sudo")),
    ).toEqual([]);
  });

  test("an older driver is upgraded to the pin; a newer one is left alone", async () => {
    const older = readyLinux({ driver: "0.31.0" });
    const newer = readyLinux({ driver: "0.40.0" });

    await setup(older);
    await setup(newer);

    expect(installerRuns(older)).toHaveLength(1);
    expect(older.installedVersion.value).toBe("0.32.0");
    expect(installerRuns(newer)).toEqual([]);
  });

  test("the installer runs with the pin, telemetry off and no PATH edits", async () => {
    const machine = fakeMachine({
      driver: null,
      answer: (argv, options) => {
        if (argv[0] === "/bin/bash") {
          expect(options?.env).toEqual({
            CUA_DRIVER_RS_VERSION: "0.32.0",
            CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
            CUA_DRIVER_RS_NO_MODIFY_PATH: "1",
          });
          return { exitCode: 1, output: "error: download failed" };
        }
        return undefined;
      },
    });
    const terminal = io();

    expect(await setup(machine, terminal)).toBe(1);
    expect(terminal.lines.at(-1)).toContain("error: download failed");
  });

  test("from a terminal it asks before running the sudo command, and runs it when told yes", async () => {
    const machine = readyLinux({
      commands: ["systemctl", "loginctl", "ldconfig", "apt-get", "ffmpeg"],
    });
    const terminal = io([true]);

    await setup(machine, terminal);

    expect(terminal.asked).toEqual(["Run it now with sudo?"]);
    expect(machine.runs).toContain(
      "[tty] /bin/sh -c sudo sh -c 'export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y --no-install-recommends xvfb openbox'",
    );
  });

  test("--no-sudo never runs it, even from a terminal", async () => {
    const machine = readyLinux({ commands: ["systemctl", "loginctl", "ldconfig", "apt-get"] });
    const terminal = io([true]);

    await setup(machine, terminal, true, { noSudo: true });

    expect(terminal.asked).toEqual([]);
    expect(machine.runs.some((run) => run.includes("/bin/sh -c sudo"))).toBe(false);
  });

  test("linger it cannot turn on itself goes into the one sudo command", async () => {
    const machine = readyLinux({
      linger: false,
      answer: (argv) =>
        argv[0] === "loginctl" && argv[1] === "enable-linger"
          ? { exitCode: 1, output: "Access denied" }
          : undefined,
    });
    const terminal = io();

    await setup(machine, terminal);

    expect(terminal.lines).toContain("  sudo sh -c 'loginctl enable-linger ada'");
  });

  describe("a host with a desktop session", () => {
    const desktop = () =>
      readyLinux({
        paths: [
          "/usr/libexec/at-spi-bus-launcher",
          "/opt/google/chrome/google-chrome",
          "/tmp/.X11-unix/X0",
          "/tmp/.X11-unix/X99",
        ],
      });

    test("asks whether to use it, and a virtual display is the default", async () => {
      const machine = desktop();
      const terminal = io([]);

      await setup(machine, terminal);

      expect(terminal.asked).toEqual(["Use your desktop (:0) instead of a virtual display?"]);
      expect(JSON.parse(machine.files.get(CONFIG) ?? "{}")).toEqual({
        screen: "virtual",
        display: ":99",
      });
    });

    test("uses the desktop when told so, and makes no virtual display", async () => {
      const machine = desktop();

      await setup(machine, io([true]));

      expect(JSON.parse(machine.files.get(CONFIG) ?? "{}")).toEqual({
        screen: "desktop",
        display: ":0",
      });
      expect(machine.runs.some((run) => run.includes("aop-xvfb"))).toBe(false);
    });

    test("without a terminal nobody is asked and the virtual display is used", async () => {
      const machine = desktop();
      const terminal = io();

      await setup(machine, terminal);

      expect(terminal.asked).toEqual([]);
      expect(JSON.parse(machine.files.get(CONFIG) ?? "{}")).toMatchObject({ screen: "virtual" });
    });

    test("a choice made once is kept: no question on the next run", async () => {
      const machine = desktop();
      await setup(machine, io([true]));
      const terminal = io([]);

      await setup(machine, terminal);

      expect(terminal.asked).toEqual([]);
      expect(JSON.parse(machine.files.get(CONFIG) ?? "{}")).toEqual({
        screen: "desktop",
        display: ":0",
      });
    });
  });

  test("--display picks the virtual display's number", async () => {
    const machine = readyLinux();

    await setup(machine, io(), true, { display: ":218" });

    expect(JSON.parse(machine.files.get(CONFIG) ?? "{}")).toEqual({
      screen: "virtual",
      display: ":218",
    });
    expect(machine.files.get(`${HOME}/.config/systemd/user/aop-xvfb.service`)).toContain(
      "Xvfb :218 ",
    );
  });
});

describe("aop computer-use setup on macOS", () => {
  const mac = (report: object) =>
    fakeMachine({
      platform: "darwin",
      driver: "0.32.0",
      answer: (argv) =>
        argv[1] === "permissions" && argv[2] === "status"
          ? { exitCode: 0, output: JSON.stringify(report) }
          : undefined,
    });

  test("never opens the permission dialogs without a terminal; says how instead", async () => {
    const machine = mac({ daemon_running: true, accessibility: false, screen_recording: true });
    const terminal = io();

    await setup(machine, terminal, false);

    expect(machine.runs.some((run) => run.includes("permissions grant"))).toBe(false);
    expect(terminal.lines).toContain("At the Mac, run: cua-driver permissions grant");
  });

  test("from a terminal it asks first, then opens them", async () => {
    const machine = mac({ daemon_running: true, accessibility: false, screen_recording: false });
    const terminal = io([true]);

    await setup(machine, terminal, false);

    expect(terminal.asked).toEqual([
      "Open the macOS permission dialogs now? You click Allow in each.",
    ]);
    expect(machine.runs).toContain(`[tty] ${HOME}/.local/bin/cua-driver permissions grant`);
  });
});

describe("aop computer-use status", () => {
  test("prints the readiness and answers 0 when ready, 2 when not", async () => {
    const lines: string[] = [];

    expect(
      await runComputerUseStatus(
        {},
        (line) => lines.push(line),
        async () => status(true),
      ),
    ).toBe(0);
    expect(
      await runComputerUseStatus(
        {},
        () => {},
        async () => status(false),
      ),
    ).toBe(2);
    expect(lines[0]).toBe("Computer use on box: ready. CUA Driver 0.32.0 is ready on this host.");
  });

  test("--json prints the same object the host's API answers", async () => {
    const lines: string[] = [];

    await runComputerUseStatus(
      { json: true },
      (line) => lines.push(line),
      async () => status(true),
    );

    expect(JSON.parse(lines.join("\n"))).toEqual(status(true));
  });
});
