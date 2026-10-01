import { readFileSync, statSync } from "node:fs";

export interface Watchdog {
  stop: () => void;
}

export type OutputTimeoutKind = "startup" | "inactivity";

export const createWatchdog = (
  timeoutMs: number,
  getLastActivity: () => number,
  onTimeout: () => void,
  checkIntervalMs = 5000,
): Watchdog => {
  const intervalId = setInterval(() => {
    const elapsed = Date.now() - getLastActivity();
    if (elapsed > timeoutMs) {
      clearInterval(intervalId);
      onTimeout();
    }
  }, checkIntervalMs);

  return { stop: () => clearInterval(intervalId) };
};

export const getFileMtime = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Number.NaN;
  }
};

export const fileHasNonEmptyOutput = (path: string): boolean => {
  try {
    return readFileSync(path, "utf-8").trim().length > 0;
  } catch {
    return false;
  }
};

export const createFileActivityTracker = (
  path: string,
  options: {
    getNow?: () => number;
    readMtime?: (path: string) => number;
  } = {},
): (() => number) => {
  const getNow = options.getNow ?? Date.now;
  const readMtime = options.readMtime ?? getFileMtime;
  let lastActivity = getNow();

  return () => {
    const mtime = readMtime(path);
    if (!Number.isNaN(mtime)) {
      lastActivity = mtime;
    }
    return lastActivity;
  };
};

/**
 * Dual-phase log watchdog: optional first-output (startup) deadline, then inactivity.
 * Startup stops permanently once non-empty primary log bytes appear.
 */
export const createLogOutputTimeoutWatchdog = (input: {
  logFilePath: string;
  startupTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  onTimeout: (kind: OutputTimeoutKind) => void;
  checkIntervalMs?: number;
  getNow?: () => number;
  hasNonEmptyOutput?: (path: string) => boolean;
  getLastActivity?: () => number;
}): Watchdog => {
  const getNow = input.getNow ?? Date.now;
  const hasNonEmptyOutput = input.hasNonEmptyOutput ?? fileHasNonEmptyOutput;
  const checkIntervalMs = input.checkIntervalMs ?? 5000;
  const startedAt = getNow();
  const getLastActivity =
    input.getLastActivity ?? createFileActivityTracker(input.logFilePath, { getNow });

  let phase: "startup" | "inactivity" | "done" =
    input.startupTimeoutMs && input.startupTimeoutMs > 0 ? "startup" : "inactivity";
  let fired = false;

  const fire = (kind: OutputTimeoutKind): void => {
    if (fired || phase === "done") return;
    fired = true;
    phase = "done";
    clearInterval(intervalId);
    input.onTimeout(kind);
  };

  const tick = (): void => {
    if (fired || phase === "done") return;
    const now = getNow();
    if (phase === "startup") {
      phase = advanceStartupPhase({
        hasOutput: hasNonEmptyOutput(input.logFilePath),
        timedOut: Boolean(input.startupTimeoutMs && now - startedAt > input.startupTimeoutMs),
        fireStartup: () => fire("startup"),
      });
      return;
    }
    if (input.inactivityTimeoutMs && now - getLastActivity() > input.inactivityTimeoutMs) {
      fire("inactivity");
    }
  };

  const intervalId = setInterval(tick, checkIntervalMs);

  return {
    stop: () => {
      phase = "done";
      clearInterval(intervalId);
    },
  };
};

const advanceStartupPhase = (input: {
  hasOutput: boolean;
  timedOut: boolean;
  fireStartup: () => void;
}): "startup" | "inactivity" | "done" => {
  if (input.hasOutput) return "inactivity";
  if (input.timedOut) {
    input.fireStartup();
    return "done";
  }
  return "startup";
};
