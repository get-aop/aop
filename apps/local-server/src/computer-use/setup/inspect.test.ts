import { describe, expect, test } from "bun:test";
import { inspectHost } from "./inspect.ts";
import { fakeMachine, readyLinux } from "./test-utils.ts";

const options = {
  config: {},
  setupCommand: "aop-nightly computer-use setup",
  driverNeedsSetup: false,
};

describe("what the host shows beside the driver", () => {
  test("a ready Linux host: the screen is up, nothing is missing, nothing to fix", async () => {
    const { sys } = readyLinux({ env: { DISPLAY: ":99" } });

    const result = await inspectHost(sys, options);

    expect(result.noDisplay).toBe(false);
    expect(result.checks.map((check) => [check.id, check.ok])).toEqual([
      ["display", true],
      ["system-packages", true],
      ["browser", true],
    ]);
    expect(result.fix).toEqual({
      command: null,
      sudoCommand: null,
      missing: [],
      pinnedVersion: "0.32.0",
    });
  });

  test("the configured display wins over the host's DISPLAY, and a dead one is no screen", async () => {
    const { sys } = readyLinux({ env: { DISPLAY: ":99" } });

    const result = await inspectHost(sys, {
      ...options,
      config: { display: ":218", screen: "virtual" },
    });

    expect(result.noDisplay).toBe(true);
    expect(result.checks[0]?.detail).toBe("X display :218 is not running.");
    expect(result.fix.command).toBe("aop-nightly computer-use setup");
  });

  test("a bare host names what is missing and the one sudo command", async () => {
    const { sys } = fakeMachine();

    const result = await inspectHost(sys, options);

    expect(result.checks[0]?.detail).toContain("No X display is configured");
    expect(result.fix.sudoCommand).toStartWith(
      "sudo sh -c 'export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install",
    );
    expect(result.fix.missing).toContain("Xvfb (the virtual display)");
    expect(result.fix.missing).toContain("Google Chrome (CUA Driver's browser)");
  });

  test("macOS has no Linux checks; setup is the fix only when the driver needs it", async () => {
    const { sys } = fakeMachine({ platform: "darwin" });

    expect(await inspectHost(sys, options)).toMatchObject({ checks: [], fix: { command: null } });
    expect((await inspectHost(sys, { ...options, driverNeedsSetup: true })).fix.command).toBe(
      "aop-nightly computer-use setup",
    );
  });
});
