import { getLogger } from "@aop/infra";

const logger = getLogger("process", "periodic-job");

export interface PeriodicJob {
  /** Names the job in the log when a run fails. */
  name: string;
  run: () => Promise<unknown>;
  /** The first run waits this long after start, so it never slows the host's start. */
  startupDelayMs: number;
  intervalMs: number;
}

/**
 * Runs a housekeeping job shortly after start and then on an interval. A run still going when
 * the next is due is not doubled, and a failed run is logged and retried at the next tick.
 * Returns what stops it. The timers never keep the process alive.
 */
export const startPeriodicJob = (job: PeriodicJob): (() => void) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await job.run();
    } catch (error) {
      logger.error("{job} failed: {error}", { job: job.name, error: String(error) });
    } finally {
      running = false;
    }
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), job.intervalMs);
    interval.unref?.();
  }, job.startupDelayMs);
  first.unref?.();
  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
};
