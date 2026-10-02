import type { PlanUsage } from "@aop/common";
import { useEffect, useSyncExternalStore } from "react";
import { getPlanUsage } from "../api/plan-usage";

/**
 * The Claude plan's usage, read from the host once a minute while a meter is on screen. The host
 * only learns new numbers when a run reports them, so a minute is fresh enough; a host that does
 * not answer is asked less and less often, up to every ten minutes.
 */
export interface PlanUsageState {
  usage: PlanUsage | null;
}

export interface PlanUsagePolling {
  pollMs: number;
  maxBackoffMs: number;
}

const DEFAULT_POLLING: PlanUsagePolling = { pollMs: 60_000, maxBackoffMs: 10 * 60_000 };
const INITIAL: PlanUsageState = { usage: null };

let state: PlanUsageState = INITIAL;
let polling: PlanUsagePolling = DEFAULT_POLLING;
let failures = 0;
let watchers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let ticks = 0;
const listeners = new Set<() => void>();

/** The plan usage, kept current while the calling component is mounted. */
export const usePlanUsage = (): PlanUsageState => {
  useEffect(startWatching, []);
  return useSyncExternalStore(subscribe, () => state);
};

/** Reads the host's plan usage now. Silent on failure: the meter keeps what it had. */
export const refreshPlanUsage = async (): Promise<void> => {
  const asked = generation;
  try {
    const usage = await getPlanUsage();
    if (asked !== generation) return;
    failures = 0;
    publish({ usage });
  } catch {
    if (asked === generation) failures += 1;
  }
};

/** The wait before the next read: a minute, doubled for every failure in a row, up to the cap. */
export const nextPollDelay = (failed: number, { pollMs, maxBackoffMs }: PlanUsagePolling): number =>
  Math.min(pollMs * 2 ** failed, Math.max(pollMs, maxBackoffMs));

/** Test seam: forget everything and poll with `next` timings. */
export const resetPlanUsageForTests = (next: Partial<PlanUsagePolling> = {}): void => {
  stopTimer();
  generation += 1;
  state = INITIAL;
  polling = { ...DEFAULT_POLLING, ...next };
  failures = 0;
  for (const listener of listeners) listener();
};

// One poller however many meters are on screen; it stops with the last of them.
const startWatching = (): (() => void) => {
  watchers += 1;
  if (watchers === 1) {
    document.addEventListener("visibilitychange", onVisible);
    void tick();
  }
  return () => {
    watchers -= 1;
    if (watchers > 0) return;
    document.removeEventListener("visibilitychange", onVisible);
    stopTimer();
  };
};

// A hidden page is not read; it reads again the moment it comes back.
const tick = async (): Promise<void> => {
  stopTimer();
  const mine = ++ticks;
  if (document.visibilityState !== "hidden") await refreshPlanUsage();
  // A newer tick (the page came back, or a meter remounted) owns the timer now.
  if (watchers > 0 && mine === ticks) timer = setTimeout(tick, nextPollDelay(failures, polling));
};

const onVisible = () => {
  if (document.visibilityState === "visible") void tick();
};

const stopTimer = () => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
};

const publish = (patch: Partial<PlanUsageState>): void => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
