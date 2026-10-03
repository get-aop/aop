import { describe, expect, test } from "bun:test";
import { upgradePinnedDriver } from "./auto-upgrade.ts";
import { fakeMachine, readyLinux } from "./test-utils.ts";

const installs = (runs: string[]) => runs.filter((run) => run.includes("cua.ai/driver/install.sh"));

describe("bringing CUA Driver up to the pin on boot", () => {
  test("an installed driver older than the pin is upgraded", async () => {
    const machine = readyLinux({ driver: "0.31.0" });

    expect(await upgradePinnedDriver(machine.sys)).toBe("upgraded");
    expect(machine.installedVersion.value).toBe("0.32.0");
  });

  test("no driver, a current one, a newer one, or one that does not answer: nothing runs", async () => {
    for (const driver of [null, "0.32.0", "0.40.1"]) {
      const machine = fakeMachine({ driver });
      expect(await upgradePinnedDriver(machine.sys)).toBe("none");
      expect(installs(machine.runs)).toEqual([]);
    }
  });

  test("AOP_CUA_AUTO_UPGRADE=0, a driver of its own, or a test run turn it off", async () => {
    const envs: Record<string, string>[] = [
      { AOP_CUA_AUTO_UPGRADE: "0" },
      { AOP_CUA_DRIVER: "/opt/cua/build/cua-driver" },
      { NODE_ENV: "test" },
    ];
    for (const env of envs) {
      const machine = readyLinux({ driver: "0.31.0", env });
      expect(await upgradePinnedDriver(machine.sys)).toBe("off");
      expect(installs(machine.runs)).toEqual([]);
    }
  });

  test("on macOS the app is started again after the swap", async () => {
    const machine = fakeMachine({ platform: "darwin", driver: "0.31.0" });

    expect(await upgradePinnedDriver(machine.sys)).toBe("upgraded");
    expect(machine.runs.at(-1)).toBe("open -n -g -a CuaDriver --args serve");
  });
});
