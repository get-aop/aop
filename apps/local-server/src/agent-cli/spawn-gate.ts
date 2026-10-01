/** A launch never waits longer than an update may take; past it, the run starts anyway. */
export const MAX_SPAWN_WAIT_MS = 10 * 60_000;

interface Gate {
  opened: Promise<void>;
  open: () => void;
}

// One host process runs every launch, so the gate is the module's own state.
const gates = new Map<string, Gate>();

/**
 * Holds every new launch of `provider`'s CLI until the returned function is called, so no run
 * starts on a half-installed CLI. Runs already in flight are not touched. The update service
 * runs one update per CLI at a time, so a gate is closed by one owner at a time.
 */
export const closeSpawnGate = (provider: string): (() => void) => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const gate: Gate = { opened, open };
  gates.set(provider, gate);
  return () => {
    if (gates.get(provider) === gate) gates.delete(provider);
    gate.open();
  };
};

/** Resolves at once unless an update of `provider`'s CLI is running, then when it ends. */
export const waitForSpawnGate = async (
  provider: string,
  maxWaitMs: number = MAX_SPAWN_WAIT_MS,
): Promise<void> => {
  const gate = gates.get(provider);
  if (!gate) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxWaitMs);
  });
  try {
    await Promise.race([gate.opened, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

export const isSpawnGateClosed = (provider: string): boolean => gates.has(provider);
