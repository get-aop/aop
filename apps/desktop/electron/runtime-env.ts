/** `AOP_DESKTOP_LOCAL_SERVER_PORT`: development runs a second app beside a released one, on its own port. */
export const portFromEnv = (value: string | undefined): number | null => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
};

/** Runs `run` after `delayMs`; returns what cancels it. The `schedule` port every timer takes. */
export const timer = (run: () => void, delayMs: number): (() => void) => {
  const handle = setTimeout(run, delayMs);
  return () => clearTimeout(handle);
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
