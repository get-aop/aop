/** Delay before the startup check, so a booting host serves its first requests first. */
export const STARTUP_CHECK_DELAY_MS = 5_000;
/** How often the scheduler wakes to see whether a check is due; a changed interval applies within it. */
export const DUE_POLL_MS = 60_000;
/** A failed check is retried after this, doubling on each failure up to the interval. */
export const FIRST_RETRY_MS = 60_000;

export interface CheckSchedulerDeps {
  /** Minutes between checks, read at every wake-up; 0 turns the periodic check off. */
  intervalMinutes: () => Promise<number>;
  /** One check of every CLI; resolves false when it could not reach the release channel. */
  check: () => Promise<boolean>;
  now?: () => number;
}

export interface CheckScheduler {
  start: () => void;
  stop: () => void;
  /** Runs the wake-up now (a test seam, and what a setting change could call). */
  tick: () => Promise<void>;
}

/**
 * Wakes every minute and checks when the interval has passed since the last attempt, starting
 * shortly after boot. Offline is a failure like any other: the next attempt backs off (1, 2, 4…
 * minutes, never beyond the interval), so a laptop without network neither hammers the
 * registry nor waits a whole interval once it is back. Nothing it does can throw into the host.
 */
export const createCheckScheduler = (deps: CheckSchedulerDeps): CheckScheduler => {
  const now = deps.now ?? Date.now;
  let lastAttemptAt: number | null = null;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let running = false;

  const due = (intervalMs: number): boolean => {
    if (lastAttemptAt === null) return true;
    const wait =
      failures > 0 ? Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), intervalMs) : intervalMs;
    return now() - lastAttemptAt >= wait;
  };

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const minutes = await deps.intervalMinutes();
      if (minutes <= 0 || !due(minutes * 60_000)) return;
      lastAttemptAt = now();
      const ok = await deps.check().catch(() => false);
      failures = ok ? 0 : failures + 1;
    } catch {
      // A setting that cannot be read leaves the schedule as it was until the next wake-up.
    } finally {
      running = false;
    }
  };

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick().finally(() => schedule(DUE_POLL_MS));
    }, delayMs);
    timer.unref?.();
  };

  return {
    start: () => {
      if (!stopped) return;
      stopped = false;
      schedule(STARTUP_CHECK_DELAY_MS);
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    tick,
  };
};
