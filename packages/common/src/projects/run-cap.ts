/**
 * The host runs at most this many thread turns at once (the `max_concurrent_runs` setting).
 * The host validates a saved value with `parseMaxConcurrentRuns` and the Settings screen
 * checks the same rule before saving, so a value one accepts the other accepts.
 */

/**
 * Four parallel Claude Code processes fit a laptop and leave room for the coordinators, whose
 * turns are not counted; a person with more headroom raises it.
 */
export const DEFAULT_MAX_CONCURRENT_RUNS = 4;
export const MAX_CONCURRENT_RUNS_LIMIT = 32;

/** The cap a stored value means, or null when it is not a whole number in range. */
export const parseMaxConcurrentRuns = (value: string): number | null => {
  if (!/^[1-9]\d{0,2}$/.test(value)) return null;
  const cap = Number(value);
  return cap <= MAX_CONCURRENT_RUNS_LIMIT ? cap : null;
};
