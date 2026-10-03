import { describe, expect, test } from "bun:test";
import type { CuaCheck, CuaStatus } from "./computer-use.ts";
import { CUA_COMMANDS, cuaSetupSteps } from "./cua-setup.ts";

const check = (id: CuaCheck["id"], ok: boolean | null, label: string = id): CuaCheck => ({
  id,
  label,
  required: true,
  ok,
  detail: "",
});

const status = (overrides: Partial<CuaStatus>): CuaStatus => ({
  status: "ready",
  reason: "ready",
  detail: "",
  path: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
  version: "0.32.0",
  latestVersion: "0.32.0",
  checks: [],
  fix: {
    command: "aop computer-use setup",
    sudoCommand: null,
    missing: [],
    pinnedVersion: "0.32.0",
  },
  host: { name: "Studio Mac", platform: "darwin" },
  checkedAt: "2026-10-01T12:00:00.000Z",
  ...overrides,
});

const ids = (s: CuaStatus) => cuaSetupSteps(s).map((step) => step.id);
const commands = (s: CuaStatus) =>
  cuaSetupSteps(s).flatMap((step) => step.commands.map((c) => c.command));

describe("cuaSetupSteps", () => {
  test("a ready, up-to-date host needs nothing", () => {
    expect(cuaSetupSteps(status({}))).toEqual([]);
  });

  test("not installed: install, start, grant, and the note that nothing else is configured", () => {
    const steps = status({ status: "not-installed", reason: "not-installed", path: null });

    expect(ids(steps)).toEqual(["install", "start", "permissions", "config"]);
    expect(commands(steps)).toContain("aop computer-use setup");
    expect(cuaSetupSteps(steps).find((s) => s.id === "permissions")?.places).toEqual([
      "System Settings › Privacy & Security › Accessibility: turn on Cua Driver",
      "System Settings › Privacy & Security › Screen & System Audio Recording: turn on Cua Driver",
    ]);
  });

  test("not running: start it, then check the grants", () => {
    expect(ids(status({ status: "not-ready", reason: "not-running" }))).toEqual([
      "start",
      "permissions",
      "config",
    ]);
  });

  test("a missing grant names only that grant and where to give it", () => {
    const steps = cuaSetupSteps(
      status({
        status: "not-ready",
        reason: "missing-permissions",
        checks: [
          check("accessibility", true, "Accessibility"),
          check("screen-recording", false, "Screen Recording"),
        ],
      }),
    );
    const grant = steps.find((step) => step.id === "permissions");

    expect(grant?.body).toContain("needs Screen Recording,");
    expect(grant?.places).toEqual([
      "System Settings › Privacy & Security › Screen & System Audio Recording: turn on Cua Driver",
    ]);
    expect(grant?.commands.map((c) => c.command)).toEqual([
      CUA_COMMANDS.grant,
      CUA_COMMANDS.permissionsStatus,
    ]);
  });

  test("a driver that does not answer is repaired by AOP's setup", () => {
    const steps = status({ status: "not-ready", reason: "no-answer" });

    expect(ids(steps)).toEqual(["install", "permissions", "config"]);
    expect(cuaSetupSteps(steps)[0]?.title).toBe("Repair CUA Driver");
    expect(commands(steps)).toEqual(
      expect.arrayContaining(["aop computer-use setup", CUA_COMMANDS.doctor]),
    );
  });

  test("a ready host behind the version AOP pins is updated by AOP's setup", () => {
    const behind = status({ version: "0.31.0", checks: [check("up-to-date", false)] });

    expect(ids(behind)).toEqual(["install"]);
    expect(cuaSetupSteps(behind)[0]?.title).toBe("Update CUA Driver to 0.32.0");
  });

  test("off macOS there are no grants or app to start", () => {
    const linux = status({
      status: "not-installed",
      reason: "not-installed",
      host: { name: "box", platform: "linux" },
    });

    expect(ids(linux)).toEqual(["install", "config"]);
  });

  test("the host's own command is used: AOP Nightly's is aop-nightly", () => {
    const linux = status({
      status: "not-installed",
      reason: "not-installed",
      host: { name: "box", platform: "linux" },
      fix: {
        command: "aop-nightly computer-use setup",
        sudoCommand: null,
        missing: [],
        pinnedVersion: "0.32.0",
      },
    });

    expect(commands(linux)).toEqual(["aop-nightly computer-use setup"]);
  });

  test("Linux packages that need root come first, as one sudo command naming what is missing", () => {
    const linux = status({
      status: "not-ready",
      reason: "no-display",
      host: { name: "box", platform: "linux" },
      fix: {
        command: "aop computer-use setup",
        sudoCommand: "sudo apt-get install -y xvfb openbox",
        missing: ["Xvfb", "openbox"],
        pinnedVersion: "0.32.0",
      },
    });

    expect(ids(linux)).toEqual(["packages", "display", "config"]);
    const [packages] = cuaSetupSteps(linux);
    expect(packages?.body).toContain("needs Xvfb and openbox");
    expect(packages?.commands).toEqual([
      { label: "Install with sudo", command: "sudo apt-get install -y xvfb openbox" },
    ]);
  });
});
