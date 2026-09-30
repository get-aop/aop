import type { PollResult } from "./poll.ts";

/** How often the watcher looks at a pull request. */
export interface Timing {
  /** Between looks at a pull request that is changing, or has just begun to wait on its checks. */
  activeMs: number;
  /** Checks that keep running are looked at less often too, up to this: a stuck check must not be read every 30 seconds for good. */
  pendingMs: number;
  /** A pull request that stays as it is is looked at less and less often, up to this. */
  quietMs: number;
  /** After a look that failed, the wait doubles from `activeMs` on each failure, up to this. */
  backoffMs: number;
  /** When GitHub throttles a repository, all of its pull requests wait this long. */
  rateLimitMs: number;
  /** Each wait is spread by up to this share either way, so pull requests do not all look at once. */
  jitter: number;
}

export const DEFAULT_TIMING: Timing = {
  activeMs: 30_000,
  pendingMs: 2 * 60_000,
  quietMs: 5 * 60_000,
  backoffMs: 15 * 60_000,
  rateLimitMs: 10 * 60_000,
  jitter: 0.2,
};

/** When a pull request is next due, and how long it has been unchanged or failing. */
export interface Schedule {
  nextAt: number;
  unchanged: number;
  failures: number;
}

/** A pull request nobody has looked at yet is due at once. */
export const dueNow = (now: number): Schedule => ({ nextAt: now, unchanged: 0, failures: 0 });

/** The schedule after a look: soon while something is happening, later while nothing is, later still while looking fails. */
export const afterPoll = (
  previous: Schedule,
  result: PollResult,
  now: number,
  timing: Timing,
  random: () => number,
): Schedule => {
  const wait = (ms: number) => now + spread(ms, timing.jitter, random);
  if (result.kind === "failed") {
    const failures = previous.failures + 1;
    return {
      nextAt: wait(Math.min(timing.backoffMs, timing.activeMs * 2 ** failures)),
      unchanged: 0,
      failures,
    };
  }
  const changed = result.kind === "polled" && result.changed;
  const waiting = result.kind === "polled" && result.pending;
  const unchanged = changed ? 0 : previous.unchanged + 1;
  // Waiting on checks starts at the active pace and slows down; standing still starts slower.
  const steps = waiting ? Math.max(0, unchanged - 1) : unchanged;
  const cap = waiting ? Math.min(timing.pendingMs, timing.quietMs) : timing.quietMs;
  return {
    nextAt: wait(Math.min(cap, timing.activeMs * 2 ** steps)),
    unchanged,
    failures: 0,
  };
};

/** When a repository that GitHub is throttling is looked at again. */
export const blockedUntil = (now: number, timing: Timing, random: () => number): number =>
  now + spread(timing.rateLimitMs, timing.jitter, random);

const spread = (ms: number, jitter: number, random: () => number): number =>
  Math.round(ms * (1 - jitter + 2 * jitter * random()));
