import { describe, expect, test } from "bun:test";
import { createCuaLease } from "../lease.ts";
import { DRIVER_SWAP_HOLDER, upgradePinnedDriver } from "./auto-upgrade.ts";
import { fakeMachine, readyLinux } from "./test-utils.ts";

const installs = (runs: string[]) => runs.filter((run) => run.includes("cua.ai/driver/install.sh"));

const until = async (done: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 200 && !done(); tries++) await Bun.sleep(1);
  expect(done()).toBe(true);
};

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

  test("waits for the thread using computer use, then holds the lease for the swap so others queue behind it", async () => {
    const machine = readyLinux({ driver: "0.31.0" });
    // The installer runs until the test lets it finish.
    let finishInstall = () => {};
    const installing = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    let installStarted = false;
    const run = machine.sys.run;
    machine.sys.run = async (argv, options) => {
      if (argv[2]?.includes("cua.ai/driver/install.sh")) {
        installStarted = true;
        await installing;
      }
      return run(argv, options);
    };
    const lease = createCuaLease({ every: () => () => {} });
    const thread = (id: string) => ({ id, projectId: "prj_1", title: `Thread ${id}` });
    expect(lease.tryAcquire(thread("a"))).toBe(true);

    const upgrading = upgradePinnedDriver(machine.sys, () => lease);
    await until(() => lease.state().queue.length === 1);
    expect(lease.state().queue[0]?.threadId).toBe(DRIVER_SWAP_HOLDER.id);
    expect(installStarted).toBe(false);

    await lease.release("a", "end-session");
    await until(() => installStarted);
    expect(lease.holderId()).toBe(DRIVER_SWAP_HOLDER.id);
    expect(lease.tryAcquire(thread("b"))).toBe(false);
    const waiting = lease.acquire(thread("b"), { maxWaitMs: 5_000 });

    finishInstall();
    expect(await upgrading).toBe("upgraded");
    expect(await waiting).toEqual({ kind: "granted" });
    expect(lease.holderId()).toBe("b");
    lease.stop();
  });

  test("an up-to-date driver never takes the lease", async () => {
    const machine = readyLinux({ driver: "0.32.0" });
    let asked = 0;

    const result = await upgradePinnedDriver(machine.sys, () => {
      asked += 1;
      return createCuaLease({ every: () => () => {} });
    });

    expect(result).toBe("none");
    expect(asked).toBe(0);
  });

  test("on macOS the app is started again after the swap", async () => {
    const machine = fakeMachine({ platform: "darwin", driver: "0.31.0" });

    expect(await upgradePinnedDriver(machine.sys)).toBe("upgraded");
    expect(machine.runs.at(-1)).toBe("open -n -g -a CuaDriver --args serve");
  });
});
