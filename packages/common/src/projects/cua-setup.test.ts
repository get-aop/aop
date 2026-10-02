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
    expect(commands(steps)).toContain(CUA_COMMANDS.install);
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

  test("a driver that does not answer is repaired by updating it", () => {
    const steps = status({ status: "not-ready", reason: "no-answer" });

    expect(ids(steps)).toEqual(["update", "permissions", "config"]);
    expect(commands(steps)).toEqual(
      expect.arrayContaining([CUA_COMMANDS.update, CUA_COMMANDS.doctor]),
    );
  });

  test("a ready host with a newer release gets the update step only", () => {
    const behind = status({ latestVersion: "0.33.0", checks: [check("up-to-date", false)] });

    expect(ids(behind)).toEqual(["update"]);
    expect(cuaSetupSteps(behind)[0]?.body).toContain("0.33.0 is out");
  });

  test("off macOS there are no grants or app to start", () => {
    const linux = status({
      status: "not-installed",
      reason: "not-installed",
      host: { name: "box", platform: "linux" },
    });

    expect(ids(linux)).toEqual(["install", "config"]);
  });
});
