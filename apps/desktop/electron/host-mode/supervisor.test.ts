import { describe, expect, test } from "bun:test";
import type { HostProcessState } from "../../src/backend/types";
import { createManualScheduler, flush } from "../connection/test-utils";
import { createHostSupervisor, type ManagedChild, type SupervisorDeps } from "./supervisor";
import type { PortProbe } from "./supervisor-state";

/** A server process the test can kill, crash or hold back. */
const createFakeChild = () => {
  let resolveExit: (value: { code: number | null; error?: string }) => void = () => {};
  const signals: string[] = [];
  const child: ManagedChild = {
    exited: new Promise((resolve) => {
      resolveExit = resolve;
    }),
    kill: (signal) => {
      signals.push(signal);
    },
  };
  return {
    child,
    signals,
    exit: (code: number | null, error?: string) =>
      resolveExit({ code, ...(error ? { error } : {}) }),
  };
};

const setup = (options: { probe?: PortProbe; healthyVersion?: string | null } = {}) => {
  const clock = createManualScheduler();
  const children: ReturnType<typeof createFakeChild>[] = [];
  const changes: HostProcessState[] = [];
  const state = {
    probe: options.probe ?? ({ kind: "free" } as PortProbe),
    healthyVersion: options.healthyVersion === undefined ? "0.9.51" : options.healthyVersion,
    spawnError: null as Error | null,
    now: 1_000_000,
    /** When set, the SIGTERM grace period runs out at once. */
    graceExpires: false,
    /** When set, the port check does not answer until `releaseProbe` is called. */
    holdProbe: false,
    releaseProbe: () => {},
  };
  const deps: SupervisorDeps = {
    port: 25150,
    probe: () =>
      state.holdProbe
        ? new Promise((resolve) => {
            state.releaseProbe = () => resolve(state.probe);
          })
        : Promise.resolve(state.probe),
    waitHealthy: async () => state.healthyVersion,
    spawn: () => {
      if (state.spawnError) throw state.spawnError;
      const fake = createFakeChild();
      children.push(fake);
      return fake.child;
    },
    now: () => state.now,
    schedule: clock.schedule,
    sleep: (ms) => (state.graceExpires ? Promise.resolve() : new Promise(() => void ms)),
    onChange: (next) => changes.push(next),
  };
  return { supervisor: createHostSupervisor(deps), clock, children, changes, state };
};

describe("starting the host", () => {
  test("starts a server when nobody is listening, and reports it running", async () => {
    const { supervisor, children, changes } = setup();

    const result = await supervisor.start();

    expect(result).toEqual({ status: "running", ownership: "spawned", version: "0.9.51" });
    expect(children).toHaveLength(1);
    expect(changes.map((s) => s.status)).toEqual(["starting", "running"]);
  });

  test("adopts a host that is already running, and starts nothing", async () => {
    const { supervisor, children } = setup({ probe: { kind: "aop", version: "0.9.40" } });

    expect(await supervisor.start()).toEqual({
      status: "running",
      ownership: "adopted",
      version: "0.9.40",
    });
    expect(children).toHaveLength(0);
  });

  test("says so when another program holds the port", async () => {
    const { supervisor, children } = setup({ probe: { kind: "occupied" } });

    const result = await supervisor.start();

    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.message).toContain("Port 25150");
    expect(children).toHaveLength(0);
  });

  test("fails, and kills the process, when the server never answers", async () => {
    const { supervisor, children } = setup({ healthyVersion: null });

    const result = await supervisor.start();

    expect(result.status).toBe("failed");
    expect(children[0]?.signals).toEqual(["SIGTERM"]);
  });

  test("fails with the reason when the server cannot be launched at all", async () => {
    const { supervisor, state } = setup();
    state.spawnError = new Error("ENOENT: no such file");

    const result = await supervisor.start();

    expect(result.status === "failed" && result.message).toContain("ENOENT");
  });

  test("fails when the process reports it could not start", async () => {
    const { supervisor, children } = setup({ healthyVersion: null });
    const started = supervisor.start();
    await flush();

    children[0]?.exit(null, "spawn aop ENOENT");
    const result = await started;

    expect(result.status).toBe("failed");
  });

  test("a second start while one runs joins it instead of starting another server", async () => {
    const { supervisor, children } = setup();

    await Promise.all([supervisor.start(), supervisor.start()]);
    await supervisor.start();

    expect(children).toHaveLength(1);
  });
});

describe("keeping the host running", () => {
  test("starts a server that dies again, after the wait the state machine asks for", async () => {
    const { supervisor, children, clock, changes } = setup();
    await supervisor.start();

    children[0]?.exit(1);
    await flush();
    expect(supervisor.state()).toEqual({ status: "restarting", attempt: 1 });
    expect(clock.waiting()).toEqual([1_000]);

    clock.fire();
    await flush();
    await flush();

    expect(supervisor.state().status).toBe("running");
    expect(children).toHaveLength(2);
    expect(changes.map((s) => s.status)).toEqual([
      "starting",
      "running",
      "restarting",
      "starting",
      "running",
    ]);
  });

  test("gives up after a server keeps dying, and says so", async () => {
    const { supervisor, children, clock } = setup();
    await supervisor.start();

    for (let death = 0; death < 4; death += 1) {
      children[death]?.exit(1);
      await flush();
      clock.fire();
      await flush();
      await flush();
    }

    expect(supervisor.state().status).toBe("failed");
    expect(children).toHaveLength(4);
  });
});

describe("stopping the host", () => {
  test("asks the server to stop and waits until it has", async () => {
    const { supervisor, children } = setup();
    await supervisor.start();

    const stopped = supervisor.stop();
    await flush();
    expect(children[0]?.signals).toEqual(["SIGTERM"]);
    expect(supervisor.state()).toEqual({ status: "stopping" });

    children[0]?.exit(0);
    await stopped;

    expect(supervisor.state()).toEqual({ status: "stopped" });
  });

  test("force-kills a server that ignores the request", async () => {
    const { supervisor, children, state } = setup();
    await supervisor.start();
    state.graceExpires = true;

    const stopped = supervisor.stop();
    await flush();
    await flush();
    expect(children[0]?.signals).toEqual(["SIGTERM", "SIGKILL"]);

    children[0]?.exit(null);
    await stopped;
  });

  test("leaves a host it adopted running", async () => {
    const { supervisor, children } = setup({ probe: { kind: "aop", version: "1" } });
    await supervisor.start();

    await supervisor.stop();

    expect(supervisor.state()).toEqual({ status: "stopped" });
    expect(children).toHaveLength(0);
  });

  test("does not start the server when it is stopped while still checking the port", async () => {
    const { supervisor, children, state } = setup();
    state.holdProbe = true;
    void supervisor.start();
    await flush();
    expect(supervisor.state()).toEqual({ status: "starting" });

    await supervisor.stop();
    state.releaseProbe();
    await flush();
    await flush();

    expect(children).toHaveLength(0);
    expect(supervisor.state()).toEqual({ status: "stopped" });
  });

  test("a start that follows a stop waits for the old server to be gone", async () => {
    const { supervisor, children } = setup();
    await supervisor.start();
    const stopped = supervisor.stop();
    await flush();

    const restarted = supervisor.start();
    await flush();
    expect(children).toHaveLength(1);

    children[0]?.exit(0);
    await stopped;
    const result = await restarted;

    expect(result.status).toBe("running");
    expect(children).toHaveLength(2);
  });
});
