import type { HostProcessState } from "../../src/backend/types";
import {
  initialState,
  type PortProbe,
  publicState,
  type SupervisorCommand,
  type SupervisorEvent,
  type SupervisorState,
  transition,
} from "./supervisor-state";

export interface ManagedChild {
  /** Resolves once the process is gone; `error` says why a process could not start at all. */
  exited: Promise<{ code: number | null; error?: string }>;
  kill: (signal: "SIGTERM" | "SIGKILL") => void;
}

export interface SupervisorDeps {
  port: number;
  /** Who is listening on the port: nobody, an AOP host, or something else. */
  probe: () => Promise<PortProbe>;
  /** Resolves with the host's version once it answers, or null if it never does. */
  waitHealthy: () => Promise<string | null>;
  spawn: () => ManagedChild;
  now: () => number;
  schedule: (run: () => void, delayMs: number) => () => void;
  /** Resolves after `ms`; injectable so a test does not wait for a real grace period. */
  sleep: (ms: number) => Promise<void>;
  onChange: (state: HostProcessState) => void;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface HostSupervisor {
  /** Starts the host, or adopts one that is already running. Resolves once it is running or has failed. */
  start: () => Promise<HostProcessState>;
  /** Stops a host this supervisor started. Resolves once it is gone. */
  stop: () => Promise<void>;
  state: () => HostProcessState;
}

const KILL_GRACE_MS = 5_000;

export const createHostSupervisor = (deps: SupervisorDeps): HostSupervisor => {
  let machine: SupervisorState = initialState;
  let child: ManagedChild | null = null;
  let cancelRestart: (() => void) | null = null;
  const waiters = new Set<() => void>();

  const shown = (): HostProcessState => publicState(machine, deps.port);

  const dispatch = (event: SupervisorEvent): void => {
    const before = JSON.stringify(shown());
    const step = transition(machine, event);
    machine = step.state;
    if (JSON.stringify(shown()) !== before) {
      deps.log?.("host process", { state: shown() });
      deps.onChange(shown());
    }
    for (const command of step.commands) execute(command);
    for (const waiter of [...waiters]) waiter();
  };

  const awaitHealthy = (): void => {
    void deps.waitHealthy().then((version) => {
      dispatch(
        version === null ? { type: "unhealthy" } : { type: "healthy", version, at: deps.now() },
      );
    });
  };

  const execute = (command: SupervisorCommand): void => {
    switch (command.type) {
      case "probe":
        void deps.probe().then((probe) => dispatch({ type: "probed", probe, at: deps.now() }));
        break;
      case "spawn":
        spawnChild();
        break;
      case "await-healthy":
        awaitHealthy();
        break;
      case "kill":
        void killChild();
        break;
      case "schedule-restart":
        cancelRestart = deps.schedule(() => dispatch({ type: "restart-due" }), command.delayMs);
        break;
      case "cancel-restart":
        cancelRestart?.();
        cancelRestart = null;
        break;
    }
  };

  const spawnChild = (): void => {
    let spawned: ManagedChild;
    try {
      spawned = deps.spawn();
    } catch (error) {
      dispatch({
        type: "spawn-failed",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    child = spawned;
    void spawned.exited.then(({ code, error }) => {
      // A child this supervisor already let go of (killed after failing to start) is no news.
      if (child !== spawned) return;
      child = null;
      dispatch({ type: "exited", code, at: deps.now(), ...(error ? { error } : {}) });
    });
    dispatch({ type: "spawned" });
  };

  const killChild = async (): Promise<void> => {
    const target = child;
    if (!target) return dispatch({ type: "stopped" });
    // A server asked politely gets the chance to close its database; one that ignores it does not get to linger.
    target.kill("SIGTERM");
    const gone = await Promise.race([
      target.exited.then(() => true),
      deps.sleep(KILL_GRACE_MS).then(() => false),
    ]);
    if (!gone) target.kill("SIGKILL");
  };

  const settled = (): boolean =>
    machine.status === "running" || machine.status === "failed" || machine.status === "stopped";

  const until = (done: () => boolean): Promise<void> =>
    new Promise((resolve) => {
      const check = () => {
        if (!done()) return;
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
      check();
    });

  return {
    start: async () => {
      // A start that arrives while the last host is still being stopped waits its turn.
      await until(() => machine.status !== "stopping");
      dispatch({ type: "start" });
      await until(() => settled() && machine.status !== "stopped");
      return shown();
    },
    stop: async () => {
      dispatch({ type: "stop" });
      await until(() => machine.status === "stopped" || machine.status === "failed");
    },
    state: shown,
  };
};
