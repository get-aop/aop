import {
  MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  MAX_CONCURRENT_RUNS_LIMIT,
  parseAgentCliCheckInterval,
  parseMaxConcurrentRuns,
} from "@aop/common";

const MAX_CONCURRENT_RUNS_KEY = "max_concurrent_runs";
const AGENT_CLI_CHECK_INTERVAL_KEY = "agent_cli_check_interval_minutes";

/**
 * Why `value` cannot be saved under `key`, or null when it can. The host refuses the same
 * values; checking here means a half-typed number never reaches it.
 */
export const settingError = (key: string, value: string): string | null => {
  if (key === MAX_CONCURRENT_RUNS_KEY && parseMaxConcurrentRuns(value) === null) {
    return `Enter a whole number from 1 to ${MAX_CONCURRENT_RUNS_LIMIT}.`;
  }
  if (key === AGENT_CLI_CHECK_INTERVAL_KEY && parseAgentCliCheckInterval(value) === null) {
    return `Enter a whole number of minutes from 0 to ${MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES}.`;
  }
  return null;
};
