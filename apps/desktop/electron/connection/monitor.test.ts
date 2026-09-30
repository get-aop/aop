import { describe, expect, test } from "bun:test";
import type { ConnectionState } from "../../src/backend/types";
import type { HostClient } from "./host-client";
import { createConnectionMonitor } from "./monitor";
import { createManualScheduler, fakeHostClient, flush, HOST } from "./test-utils";

const okHealth = {
  status: "ok" as const,
  health: { service: "aop" as const, version: "1", apiVersion: 1, minClientApiVersion: 1 },
};

const setup = (client: HostClient = fakeHostClient()) => {
  const clock = createManualScheduler();
  const seen: ConnectionState[] = [];
  const monitor = createConnectionMonitor({
    clientFor: () => client,
    schedule: clock.schedule,
    connectedIntervalMs: 15_000,
    retryIntervalMs: 4_000,
  });
  monitor.subscribe((state) => seen.push(state));
  return { monitor, clock, seen };
};

describe("createConnectionMonitor", () => {
  test("starts unconfigured", () => {
    expect(setup().monitor.state()).toEqual({ status: "unconfigured" });
  });

  test("goes connecting, then connected, when it starts watching a healthy host", async () => {
    const { monitor, seen } = setup();

    monitor.watch({ host: HOST, token: "aop_t" });
    await flush();

    expect(seen.map((state) => state.status)).toEqual(["connecting", "connected"]);
    expect(monitor.state()).toMatchObject({ status: "connected", host: HOST });
  });

  test("looks again on a slow beat while connected", async () => {
    const { monitor, clock } = setup();

    monitor.watch({ host: HOST, token: "aop_t" });
    await flush();

    expect(clock.waiting()).toEqual([15_000]);
  });

  test("looks again on a quick beat while the host is away, and says so when it returns", async () => {
    let up = false;
    const { monitor, clock, seen } = setup(
      fakeHostClient({
        health: async () =>
          up ? okHealth : { status: "unreachable", message: "away", failure: "refused" },
      }),
    );

    monitor.watch({ host: HOST, token: "aop_t" });
    await flush();
    expect(monitor.state().status).toBe("unreachable");
    expect(clock.waiting()).toEqual([4_000]);

    up = true;
    clock.fire();
    await flush();

    expect(monitor.state().status).toBe("connected");
    expect(seen.map((state) => state.status)).toEqual(["connecting", "unreachable", "connected"]);
  });

  test("tells its listeners only when something changed", async () => {
    const { monitor, clock, seen } = setup();
    monitor.watch({ host: HOST, token: "aop_t" });
    await flush();

    clock.fire();
    await flush();
    clock.fire();
    await flush();

    expect(seen).toHaveLength(2);
  });

  test("notices a device the host has removed", async () => {
    let revoked = false;
    const { monitor, clock } = setup(
      fakeHostClient({
        principal: async () =>
          revoked ? { status: "unauthorized" } : { status: "ok", principal: { kind: "owner" } },
      }),
    );
    monitor.watch({ host: HOST, token: "aop_t" });
    await flush();

    revoked = true;
    clock.fire();
    await flush();

    expect(monitor.state()).toEqual({ status: "unauthorized", host: HOST });
  });

  test("ignores the answer of a host it has stopped watching", async () => {
    let releaseSlowAnswer = () => {};
    const slow = fakeHostClient({
      health: () =>
        new Promise((resolve) => {
          releaseSlowAnswer = () => resolve(okHealth);
        }),
    });
    const { monitor } = setup(slow);

    monitor.watch({ host: HOST, token: "aop_t" });
    monitor.watch(null);
    releaseSlowAnswer();
    await flush();

    expect(monitor.state()).toEqual({ status: "unconfigured" });
  });

  test("stops looking when told to watch nothing", async () => {
    const { monitor, clock } = setup();
    monitor.watch({ host: HOST, token: "aop_t" });
    await flush();

    monitor.watch(null);

    expect(clock.waiting()).toEqual([]);
    expect(monitor.state()).toEqual({ status: "unconfigured" });
  });

  test("check looks at once and returns the result", async () => {
    const { monitor } = setup();
    monitor.watch({ host: HOST, token: "aop_t" });
    await flush();

    expect((await monitor.check()).status).toBe("connected");
  });
});
