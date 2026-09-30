import { describe, expect, test } from "bun:test";
import {
  initialState,
  MAX_RESTARTS,
  publicState,
  STABLE_AFTER_MS,
  type SupervisorCommand,
  type SupervisorEvent,
  type SupervisorState,
  transition,
} from "./supervisor-state";

/** Feeds events through the machine, returning where it ended and every command it asked for. */
const run = (events: SupervisorEvent[], from: SupervisorState = initialState) => {
  let state = from;
  const commands: SupervisorCommand[] = [];
  for (const event of events) {
    const step = transition(state, event);
    state = step.state;
    commands.push(...step.commands);
  }
  return { state, commands };
};

const AT = 1_000_000;
const free: SupervisorEvent = { type: "probed", probe: { kind: "free" }, at: AT };
const healthy = (at = AT): SupervisorEvent => ({ type: "healthy", version: "0.9.51", at });

const running = (events: SupervisorEvent[] = []) =>
  run([{ type: "start" }, free, { type: "spawned" }, healthy(), ...events]);

describe("starting", () => {
  test("looks at the port first, then starts the server, then waits for it to answer", () => {
    const { state, commands } = run([{ type: "start" }, free, { type: "spawned" }, healthy()]);

    expect(commands.map((c) => c.type)).toEqual(["probe", "spawn", "await-healthy"]);
    expect(state).toMatchObject({ status: "running", ownership: "spawned", version: "0.9.51" });
  });

  test("adopts an AOP host that is already listening, without starting a second one", () => {
    const { state, commands } = run([
      { type: "start" },
      { type: "probed", probe: { kind: "aop", version: "0.9.40" }, at: AT },
    ]);

    expect(commands.map((c) => c.type)).toEqual(["probe"]);
    expect(state).toMatchObject({ status: "running", ownership: "adopted", version: "0.9.40" });
  });

  test("gives up when something that is not AOP holds the port", () => {
    const { state } = run([
      { type: "start" },
      { type: "probed", probe: { kind: "occupied" }, at: AT },
    ]);

    expect(state).toEqual({ status: "failed", reason: "port-in-use", detail: "" });
  });

  test("fails when the server cannot be launched, or never answers, and kills what it launched", () => {
    expect(
      run([{ type: "start" }, free, { type: "spawn-failed", message: "ENOENT" }]).state,
    ).toEqual({ status: "failed", reason: "spawn-failed", detail: "ENOENT" });

    const silent = run([{ type: "start" }, free, { type: "spawned" }, { type: "unhealthy" }]);
    expect(silent.state).toMatchObject({ status: "failed", reason: "did-not-start" });
    expect(silent.commands.at(-1)).toEqual({ type: "kill" });
  });

  test("fails when the server exits before it ever answered", () => {
    const { state } = run([
      { type: "start" },
      free,
      { type: "spawned" },
      { type: "exited", code: 1, at: AT },
    ]);

    expect(state).toEqual({ status: "failed", reason: "exited-early", detail: "exit code 1" });
  });

  test("starts again from a failure", () => {
    const failed = run([
      { type: "start" },
      { type: "probed", probe: { kind: "occupied" }, at: AT },
    ]);

    const { state, commands } = run([{ type: "start" }], failed.state);

    expect(state).toEqual({ status: "starting", attempt: 0 });
    expect(commands).toEqual([{ type: "probe" }]);
  });

  test("ignores a second start while one is under way, and events that do not belong", () => {
    expect(run([{ type: "start" }, { type: "start" }]).state).toEqual({
      status: "starting",
      attempt: 0,
    });
    expect(run([{ type: "healthy", version: "1", at: AT }]).state).toEqual(initialState);
    expect(run([{ type: "exited", code: 0, at: AT }]).state).toEqual(initialState);
  });
});

describe("a server that dies while running", () => {
  test("is started again after a short wait", () => {
    const { state, commands } = running([{ type: "exited", code: 1, at: AT + 5_000 }]);

    expect(state).toEqual({ status: "restarting", attempt: 1 });
    expect(commands.at(-1)).toEqual({ type: "schedule-restart", delayMs: 1_000 });
  });

  test("waits longer after each death, up to the last restart it allows", () => {
    let step = running();
    const delays: number[] = [];
    for (let death = 0; death < MAX_RESTARTS; death += 1) {
      step = run([{ type: "exited", code: 1, at: AT + death }], step.state);
      delays.push((step.commands.at(-1) as { delayMs: number }).delayMs);
      step = run(
        [{ type: "restart-due" }, free, { type: "spawned" }, healthy(AT + death)],
        step.state,
      );
    }

    expect(delays).toEqual([1_000, 2_000, 4_000]);

    const last = run([{ type: "exited", code: 139, at: AT + 10 }], step.state);
    expect(last.state).toEqual({ status: "failed", reason: "crashed", detail: "exit code 139" });
  });

  test("earns a fresh set of restarts by staying up for a while", () => {
    let step = running();
    for (let death = 0; death < MAX_RESTARTS; death += 1) {
      step = run([{ type: "exited", code: 1, at: AT + death }], step.state);
      step = run([{ type: "restart-due" }, free, { type: "spawned" }, healthy(AT)], step.state);
    }

    const afterALongRun = run([{ type: "exited", code: 1, at: AT + STABLE_AFTER_MS }], step.state);

    expect(afterALongRun.state).toEqual({ status: "restarting", attempt: 1 });
  });

  test("comes back through the same checks, so it adopts a server that took its place", () => {
    const dead = running([{ type: "exited", code: 1, at: AT }]);

    const { state, commands } = run([{ type: "restart-due" }], dead.state);
    expect(state).toEqual({ status: "starting", attempt: 1 });
    expect(commands).toEqual([{ type: "probe" }]);

    const taken = run(
      [{ type: "probed", probe: { kind: "aop", version: "0.9.51" }, at: AT }],
      state,
    );
    expect(taken.state).toMatchObject({ status: "running", ownership: "adopted" });
  });

  test("does not restart a host it adopted; that one is not its to manage", () => {
    const adopted = run([
      { type: "start" },
      { type: "probed", probe: { kind: "aop", version: "1" }, at: AT },
    ]);

    expect(run([{ type: "exited", code: 1, at: AT }], adopted.state).state).toEqual(adopted.state);
  });
});

describe("stopping", () => {
  test("kills a server it started and is stopped once the process is gone", () => {
    const { state, commands } = running([{ type: "stop" }]);
    expect(state).toEqual({ status: "stopping" });
    expect(commands.at(-1)).toEqual({ type: "kill" });

    expect(run([{ type: "exited", code: null, at: AT }], state).state).toEqual(initialState);
    expect(run([{ type: "stopped" }], state).state).toEqual(initialState);
  });

  test("leaves an adopted host running: it stops watching, and kills nothing", () => {
    const adopted = run([
      { type: "start" },
      { type: "probed", probe: { kind: "aop", version: "1" }, at: AT },
    ]);

    const { state, commands } = run([{ type: "stop" }], adopted.state);

    expect(state).toEqual(initialState);
    expect(commands).toEqual([]);
  });

  test("cancels a restart that has not happened yet", () => {
    const waiting = running([{ type: "exited", code: 1, at: AT }]);

    const { state, commands } = run([{ type: "stop" }], waiting.state);

    expect(state).toEqual(initialState);
    expect(commands).toEqual([{ type: "cancel-restart" }]);
  });

  test("can be stopped while still starting", () => {
    const { state, commands } = run([{ type: "start" }, { type: "stop" }]);

    expect(state).toEqual({ status: "stopping" });
    expect(commands.at(-1)).toEqual({ type: "kill" });
  });

  test("does not start again while it is still stopping", () => {
    expect(run([{ type: "start" }], { status: "stopping" }).state).toEqual({ status: "stopping" });
  });
});

describe("publicState", () => {
  test("shows a running server's ownership and version", () => {
    expect(publicState(running().state, 25150)).toEqual({
      status: "running",
      ownership: "spawned",
      version: "0.9.51",
    });
  });

  test("turns each failure into a sentence, naming the port where it matters", () => {
    const message = (reason: Parameters<typeof publicState>[0] & { status: "failed" }) => {
      const shown = publicState(reason, 25150);
      return shown.status === "failed" ? shown.message : "";
    };

    expect(message({ status: "failed", reason: "port-in-use", detail: "" })).toContain(
      "Port 25150",
    );
    expect(message({ status: "failed", reason: "spawn-failed", detail: "ENOENT" })).toContain(
      "ENOENT",
    );
    expect(message({ status: "failed", reason: "did-not-start", detail: "" })).toContain("logs");
    expect(message({ status: "failed", reason: "exited-early", detail: "exit code 2" })).toContain(
      "exit code 2",
    );
    expect(message({ status: "failed", reason: "crashed", detail: "exit code 139" })).toContain(
      "keeps stopping",
    );
  });

  test("passes the quiet states through", () => {
    expect(publicState({ status: "stopped" }, 1)).toEqual({ status: "stopped" });
    expect(publicState({ status: "starting", attempt: 2 }, 1)).toEqual({ status: "starting" });
    expect(publicState({ status: "stopping" }, 1)).toEqual({ status: "stopping" });
    expect(publicState({ status: "restarting", attempt: 2 }, 1)).toEqual({
      status: "restarting",
      attempt: 2,
    });
  });
});
