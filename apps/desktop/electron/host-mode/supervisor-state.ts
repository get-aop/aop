import type { HostProcessState } from "../../src/backend/types";

/**
 * The life of the host server the app runs on this Mac, as a pure state machine: what state it
 * is in, what happened, and what to do about it. `supervisor.ts` carries the actions out and
 * feeds their outcomes back in, so every rule about starting, adopting, restarting and stopping
 * is decided (and tested) here without a process in sight.
 */

export type FailureReason =
  | "port-in-use"
  | "spawn-failed"
  | "did-not-start"
  | "exited-early"
  | "crashed";

export type SupervisorState =
  | { status: "stopped" }
  | { status: "starting"; attempt: number }
  | {
      status: "running";
      /** `adopted`: an AOP host was already listening, and the app leaves its lifetime alone. */
      ownership: "spawned" | "adopted";
      version: string;
      since: number;
      attempt: number;
    }
  | { status: "restarting"; attempt: number }
  | { status: "stopping" }
  | { status: "failed"; reason: FailureReason; detail: string };

export type PortProbe = { kind: "free" } | { kind: "aop"; version: string } | { kind: "occupied" };

export type SupervisorEvent =
  | { type: "start" }
  | { type: "probed"; probe: PortProbe; at: number }
  | { type: "spawned" }
  | { type: "spawn-failed"; message: string }
  | { type: "healthy"; version: string; at: number }
  | { type: "unhealthy" }
  | { type: "exited"; code: number | null; at: number; error?: string }
  | { type: "restart-due" }
  | { type: "stop" }
  | { type: "stopped" };

export type SupervisorCommand =
  | { type: "probe" }
  | { type: "spawn" }
  | { type: "await-healthy" }
  | { type: "kill" }
  | { type: "schedule-restart"; delayMs: number }
  | { type: "cancel-restart" };

export interface Transition {
  state: SupervisorState;
  commands: SupervisorCommand[];
}

/** A host that keeps dying is left stopped with its reason, not restarted forever. */
export const MAX_RESTARTS = 3;
/** A host that ran this long before dying earned a fresh set of restarts. */
export const STABLE_AFTER_MS = 60_000;
const RESTART_BACKOFF_MS = 1_000;

export const initialState: SupervisorState = { status: "stopped" };

export const transition = (state: SupervisorState, event: SupervisorEvent): Transition => {
  switch (state.status) {
    case "stopped":
    case "failed":
      return event.type === "start" ? begin(0) : ignore(state);
    case "starting":
      return whileStarting(state, event);
    case "running":
      return whileRunning(state, event);
    case "restarting":
      return whileRestarting(state, event);
    case "stopping":
      return event.type === "stopped" || event.type === "exited"
        ? move({ status: "stopped" })
        : ignore(state);
  }
};

const whileStarting = (
  state: Extract<SupervisorState, { status: "starting" }>,
  event: SupervisorEvent,
): Transition => {
  switch (event.type) {
    case "probed":
      return afterProbe(state, event);
    case "spawned":
      return move(state, { type: "await-healthy" });
    case "spawn-failed":
      return move({ status: "failed", reason: "spawn-failed", detail: event.message });
    case "healthy":
      return move(running("spawned", event.version, event.at, state.attempt));
    case "unhealthy":
      return move({ status: "failed", reason: "did-not-start", detail: "" }, { type: "kill" });
    case "exited":
      return move({
        status: "failed",
        reason: "exited-early",
        detail: event.error ?? `exit code ${event.code ?? "unknown"}`,
      });
    case "stop":
      return move({ status: "stopping" }, { type: "kill" });
    default:
      return ignore(state);
  }
};

const afterProbe = (
  state: Extract<SupervisorState, { status: "starting" }>,
  event: Extract<SupervisorEvent, { type: "probed" }>,
): Transition => {
  switch (event.probe.kind) {
    case "free":
      return move(state, { type: "spawn" });
    case "aop":
      return move(running("adopted", event.probe.version, event.at, state.attempt));
    case "occupied":
      return move({ status: "failed", reason: "port-in-use", detail: "" });
  }
};

const whileRunning = (
  state: Extract<SupervisorState, { status: "running" }>,
  event: SupervisorEvent,
): Transition => {
  if (event.type === "stop") {
    // An adopted host is somebody else's process: stop watching it, do not kill it.
    return state.ownership === "adopted"
      ? move({ status: "stopped" })
      : move({ status: "stopping" }, { type: "kill" });
  }
  if (event.type !== "exited" || state.ownership === "adopted") return ignore(state);

  const attempt = event.at - state.since >= STABLE_AFTER_MS ? 1 : state.attempt + 1;
  if (attempt > MAX_RESTARTS) {
    return move({
      status: "failed",
      reason: "crashed",
      detail: event.error ?? `exit code ${event.code ?? "unknown"}`,
    });
  }
  return move(
    { status: "restarting", attempt },
    { type: "schedule-restart", delayMs: RESTART_BACKOFF_MS * 2 ** (attempt - 1) },
  );
};

const whileRestarting = (
  state: Extract<SupervisorState, { status: "restarting" }>,
  event: SupervisorEvent,
): Transition => {
  if (event.type === "restart-due") return begin(state.attempt);
  if (event.type === "stop") return move({ status: "stopped" }, { type: "cancel-restart" });
  return ignore(state);
};

const begin = (attempt: number): Transition =>
  move({ status: "starting", attempt }, { type: "probe" });

const running = (
  ownership: "spawned" | "adopted",
  version: string,
  since: number,
  attempt: number,
): SupervisorState => ({ status: "running", ownership, version, since, attempt });

const move = (state: SupervisorState, ...commands: SupervisorCommand[]): Transition => ({
  state,
  commands,
});

const ignore = (state: SupervisorState): Transition => ({ state, commands: [] });

/** What the screens are shown. The reason becomes a sentence a person can act on. */
export const publicState = (state: SupervisorState, port: number): HostProcessState => {
  switch (state.status) {
    case "running":
      return { status: "running", ownership: state.ownership, version: state.version };
    case "restarting":
      return { status: "restarting", attempt: state.attempt };
    case "failed":
      return { status: "failed", message: describeFailure(state.reason, state.detail, port) };
    case "stopped":
    case "starting":
    case "stopping":
      return { status: state.status };
  }
};

const describeFailure = (reason: FailureReason, detail: string, port: number): string => {
  switch (reason) {
    case "port-in-use":
      return `Port ${port} is used by another program. Quit it, or start AOP from a terminal on a different port.`;
    case "spawn-failed":
      return `The AOP server could not be started: ${detail}`;
    case "did-not-start":
      return "The AOP server started but did not answer. Open the logs to see why.";
    case "exited-early":
      return `The AOP server stopped right after starting (${detail}). Open the logs to see why.`;
    case "crashed":
      return `The AOP server keeps stopping (${detail}). Open the logs to see why.`;
  }
};
