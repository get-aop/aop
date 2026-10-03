import { describe, expect, test } from "bun:test";
import { EMPTY_CUA_LEASE, HostSetupSchema } from "@aop/common";
import { createHostSetupService } from "./service.ts";
import { cuaNoScreen, cuaStatus, FACTS, readyProbes } from "./test-utils.ts";

describe("host setup service", () => {
  test("reports the host and every check, in order, all ready", async () => {
    const setup = await createHostSetupService({ probes: readyProbes(), facts: FACTS }).setup();

    expect(HostSetupSchema.parse(setup)).toEqual(setup);
    expect(setup).toMatchObject({
      hostName: "soulf",
      os: "linux",
      channel: "nightly",
      version: "0.10.8-nightly.20261002.17",
      uptimeSeconds: 10_800,
      addresses: ["https://soulf.tailffbdec.ts.net:25650"],
      ready: 6,
      total: 6,
    });
    expect(setup.checks.map((check) => [check.id, check.state])).toEqual([
      ["service", "ok"],
      ["reachable", "ok"],
      ["claude", "ok"],
      ["github", "ok"],
      ["computer-use", "ok"],
      ["updates", "ok"],
      ["slack-inbox", "optional"],
    ]);
  });

  test("an optional check counts neither way, and a failing one counts against ready", async () => {
    const service = createHostSetupService({
      probes: readyProbes({
        computerUse: async () => ({ status: cuaNoScreen(), lease: EMPTY_CUA_LEASE, wanted: false }),
        github: async () => ({ authenticated: false, reason: "signed-out", message: "" }),
      }),
      facts: FACTS,
    });

    const setup = await service.setup();

    expect({ ready: setup.ready, total: setup.total }).toEqual({ ready: 4, total: 5 });
  });

  test("a probe that fails or does not answer in time is reported, and the rest still answer", async () => {
    const service = createHostSetupService({
      probes: readyProbes({
        github: () => new Promise(() => {}),
        serve: async () => {
          throw new Error("tailscaled is not running");
        },
      }),
      facts: FACTS,
      timeoutMs: 20,
    });

    const setup = await service.setup();

    expect(setup.checks.find((check) => check.id === "github")).toEqual({
      id: "github",
      state: "warning",
      title: "GitHub",
      detail: "Couldn't check: no answer within 0.02s",
      actions: [],
    });
    expect(setup.checks.find((check) => check.id === "reachable")?.detail).toBe(
      "Couldn't check: tailscaled is not running",
    );
    expect(setup.addresses).toEqual([]);
    expect(setup.ready).toBe(4);
  });

  test("passes fresh on to the probes that keep recent looks", async () => {
    const asked: string[] = [];
    const probes = readyProbes();
    const service = createHostSetupService({
      probes: {
        ...probes,
        claude: (fresh) => {
          asked.push(`claude ${fresh}`);
          return probes.claude(fresh);
        },
        github: (fresh) => {
          asked.push(`github ${fresh}`);
          return probes.github(fresh);
        },
        computerUse: (fresh) => {
          asked.push(`computer-use ${fresh}`);
          return probes.computerUse(fresh);
        },
      },
      facts: FACTS,
    });

    await service.setup();
    await service.setup({ fresh: true });

    expect(asked.sort()).toEqual([
      "claude false",
      "claude true",
      "computer-use false",
      "computer-use true",
      "github false",
      "github true",
    ]);
  });

  describe("fix", () => {
    test("runs computer-use setup, then answers the checklist as it is after it", async () => {
      let ready = false;
      let runs = 0;
      const service = createHostSetupService({
        probes: readyProbes({
          computerUse: async () => ({
            status: ready ? cuaStatus() : cuaNoScreen(),
            lease: EMPTY_CUA_LEASE,
            wanted: true,
          }),
          setupComputerUse: async () => {
            runs += 1;
            ready = true;
            return 0;
          },
        }),
        facts: FACTS,
      });

      const result = await service.fix("computer-use");

      expect(runs).toBe(1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected the fix to run");
      expect(result.setup.checks.find((check) => check.id === "computer-use")?.state).toBe("ok");
    });

    test("two Fix presses at once share one run", async () => {
      let runs = 0;
      let finish = () => {};
      const service = createHostSetupService({
        probes: readyProbes({
          computerUse: async () => ({
            status: cuaNoScreen(),
            lease: EMPTY_CUA_LEASE,
            wanted: true,
          }),
          setupComputerUse: () => {
            runs += 1;
            return new Promise((resolve) => {
              finish = () => resolve(0);
            });
          },
        }),
        facts: FACTS,
      });

      const first = service.fix("computer-use");
      while (runs === 0) await Bun.sleep(1);
      const second = service.fix("computer-use");
      await Bun.sleep(5);
      finish();

      expect((await first).ok).toBe(true);
      expect((await second).ok).toBe(true);
      expect(runs).toBe(1);
    });

    test("refuses a check that has no fix now, and one that does not exist", async () => {
      let runs = 0;
      const service = createHostSetupService({
        probes: readyProbes({
          setupComputerUse: async () => {
            runs += 1;
            return 0;
          },
        }),
        facts: FACTS,
      });

      expect(await service.fix("computer-use")).toMatchObject({ ok: false, code: "NO_FIX" });
      expect(await service.fix("github")).toMatchObject({ ok: false, code: "NO_FIX" });
      expect(await service.fix("nope")).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(runs).toBe(0);
    });

    test("a fix that throws says why, with the checklist as it is", async () => {
      const service = createHostSetupService({
        probes: readyProbes({
          computerUse: async () => ({
            status: cuaNoScreen(),
            lease: EMPTY_CUA_LEASE,
            wanted: true,
          }),
          setupComputerUse: async () => {
            throw new Error("CUA's installer failed");
          },
        }),
        facts: FACTS,
      });

      const result = await service.fix("computer-use");

      expect(result).toMatchObject({
        ok: false,
        code: "FIX_FAILED",
        error: "CUA's installer failed",
      });
      if (result.ok || result.code !== "FIX_FAILED") throw new Error("expected FIX_FAILED");
      expect(result.setup.checks).toHaveLength(7);
    });
  });
});
