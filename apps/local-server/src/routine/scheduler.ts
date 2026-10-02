import { getLogger } from "@aop/infra";
import type { RoutineRepository } from "./repository.ts";
import type { RoutineClock, RoutineRunner } from "./runner.ts";

const logger = getLogger("routine");

/**
 * The longest the scheduler sleeps. It wakes for the soonest next run, but also at least this
 * often, so a clock that jumped (a laptop waking), a routine another host process wrote, or a
 * timer the OS delayed is caught within a minute.
 */
export const MAX_SLEEP_MS = 60_000;

export interface TimerApi {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface RoutineScheduler {
  /** Recovers what a stopped host left, then fires what is due and keeps watching. */
  start: () => Promise<void>;
  /** Something changed (a routine made, edited or turned on): look again now. */
  poke: () => void;
  /** Stops watching and waits for a pass in progress. */
  stop: () => Promise<void>;
}

/**
 * Keeps routines running on time. Every pass reads the stored state, and every occurrence is
 * claimed in the database (runner.ts), so passes that overlap, a restart, or a second host on
 * the same database never fire an occurrence twice.
 */
export const createRoutineScheduler = (
  runner: RoutineRunner,
  routines: Pick<RoutineRepository, "earliestNextRun">,
  clock: RoutineClock,
  timers: TimerApi = { setTimeout, clearTimeout: (handle) => clearTimeout(handle as Timer) },
): RoutineScheduler => {
  let timer: unknown = null;
  let stopped = true;
  let pass: Promise<void> | null = null;
  let again = false;

  const arm = async () => {
    if (stopped) return;
    const earliest = await routines.earliestNextRun();
    const wait = earliest === null ? MAX_SLEEP_MS : Date.parse(earliest) - clock.now().getTime();
    if (stopped) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(tick, Math.min(Math.max(wait, 0), MAX_SLEEP_MS));
  };

  // One pass at a time; a poke during a pass runs one more after it.
  const tick = () => {
    timer = null;
    if (pass) {
      again = true;
      return;
    }
    pass = runner
      .processDue()
      .catch((error: unknown) => {
        logger.error("A routine pass failed: {error}", { error: String(error) });
      })
      .then(async () => {
        pass = null;
        if (again) {
          again = false;
          tick();
          return;
        }
        await arm();
      });
  };

  return {
    start: async () => {
      stopped = false;
      await runner.recover();
      tick();
    },
    poke: () => {
      if (stopped) return;
      if (timer !== null) timers.clearTimeout(timer);
      tick();
    },
    stop: async () => {
      stopped = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      await pass;
    },
  };
};
