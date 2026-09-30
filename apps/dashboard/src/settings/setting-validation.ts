import { MAX_CONCURRENT_RUNS_LIMIT, parseMaxConcurrentRuns } from "@aop/common";

const MAX_CONCURRENT_RUNS_KEY = "max_concurrent_runs";

/**
 * Why `value` cannot be saved under `key`, or null when it can. The host refuses the same
 * values; checking here means a half-typed number never reaches it.
 */
export const settingError = (key: string, value: string): string | null => {
  if (key === MAX_CONCURRENT_RUNS_KEY && parseMaxConcurrentRuns(value) === null) {
    return `Enter a whole number from 1 to ${MAX_CONCURRENT_RUNS_LIMIT}.`;
  }
  return null;
};
