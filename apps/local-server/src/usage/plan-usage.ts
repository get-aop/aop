import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type PlanUsage, PlanUsageSchema } from "@aop/common";
import { aopPaths, getLogger } from "@aop/infra";
import { type PlanReading, readPlanLimits } from "./plan-limits-event.ts";

const logger = getLogger("plan-usage");

/*
 * The Claude plan's usage, as the host last heard it from a running Claude Code. One copy per
 * host, so every paired device reads the same numbers; it is kept in AOP_HOME as well, so a
 * restarted host still knows it before its next run.
 */

const FILE_NAME = "plan-usage.json";

interface State {
  current: PlanUsage | null;
  loaded: Promise<void> | null;
  /** Observations apply one at a time, in the order they were heard, each after the file was read. */
  queue: Promise<void>;
}

let state: State = { current: null, loaded: null, queue: Promise.resolve() };

/**
 * Hears one line of a run's stream-json output. Lines that are not a plan-limit event cost a
 * substring check. Never throws: the meter is a side view of a run, never a reason to fail it.
 */
export const observePlanUsage = (line: string, now: Date = new Date()): Promise<void> => {
  const reading = readPlanLimits(line);
  if (!reading) return state.queue;
  const target = state;
  target.queue = target.queue
    .then(async () => {
      await ensureLoaded(target);
      target.current = merge(target.current, reading, now);
      await writeSnapshot(target.current);
    })
    .catch((error: unknown) => {
      logger.warn("Could not keep the plan usage: {error}", { error: String(error) });
    });
  return target.queue;
};

/**
 * The latest plan usage the host has heard, or null when no run has reported one. It waits for
 * the observations already heard, so a reply that has settled is in it.
 */
export const getPlanUsage = async (): Promise<PlanUsage | null> => {
  const target = state;
  await target.queue;
  await ensureLoaded(target);
  return target.current;
};

/** Test seam: forget what was heard, so the next read starts from AOP_HOME's file again. */
export const resetPlanUsageForTests = (): void => {
  state = { current: null, loaded: null, queue: Promise.resolve() };
};

// A window the event does not describe keeps what the host knew of it.
const merge = (previous: PlanUsage | null, reading: PlanReading, now: Date): PlanUsage => ({
  fiveHour: reading.fiveHour ?? previous?.fiveHour ?? null,
  sevenDay: reading.sevenDay ?? previous?.sevenDay ?? null,
  updatedAt: now.toISOString(),
});

const ensureLoaded = (target: State): Promise<void> => {
  target.loaded ??= readSnapshot().then((stored) => {
    if (stored && (!target.current || stored.updatedAt > target.current.updatedAt)) {
      target.current = stored;
    }
  });
  return target.loaded;
};

const filePath = (): string => join(aopPaths.home(), FILE_NAME);

const readSnapshot = async (): Promise<PlanUsage | null> => {
  try {
    const parsed = PlanUsageSchema.safeParse(JSON.parse(await readFile(filePath(), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Written beside its target and renamed over it, so a reader never sees half a file.
const writeSnapshot = async (usage: PlanUsage): Promise<void> => {
  const path = filePath();
  await mkdir(aopPaths.home(), { recursive: true });
  const partial = `${path}.${process.pid}.tmp`;
  await writeFile(partial, JSON.stringify(usage));
  await rename(partial, path);
};
