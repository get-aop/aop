import {
  DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  DEFAULT_MAX_CONCURRENT_RUNS,
  MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  MAX_CONCURRENT_RUNS_LIMIT,
  parseAgentCliCheckInterval,
  parseMaxConcurrentRuns,
} from "@aop/common";
import type { Setting } from "../db/schema.ts";

export type { Setting };

/** Only keys that live code reads. A key is added with its first reader, not before. */
export const SettingKey = {
  /**
   * Whether the host installs a newer agent CLI (Claude Code) by itself when a check finds one.
   * "true" or "false"; off by default. An install method that cannot be replaced under a running
   * process waits until no run of that CLI is in flight (see agent-cli/).
   */
  AGENT_CLI_AUTO_UPDATE: "agent_cli_auto_update",
  /**
   * Minutes between the host's checks for newer agent CLI versions, a whole number from 0 to
   * `MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES`; 0 turns the periodic check off.
   */
  AGENT_CLI_CHECK_INTERVAL: "agent_cli_check_interval_minutes",
  /**
   * Whether every Claude Code session the host starts runs with `--dangerously-skip-permissions`.
   * "true" or "false"; off by default. Read at each launch (see agent-cli/permission-bypass.ts).
   * Only the host owner may change it (`OWNER_ONLY_SETTING_KEYS`).
   */
  AGENT_CLI_SKIP_PERMISSIONS: "agent_cli_skip_permissions",
  /**
   * Optional free-text preferences injected into every chat runtime prompt
   * (not stored in the visible message transcript).
   */
  CHAT_GLOBAL_INSTRUCTIONS: "chat_global_instructions",
  /**
   * What the host owner is called, for the dashboard to greet them by. Free text; empty (the
   * default) greets no one by name.
   */
  DISPLAY_NAME: "display_name",
  /**
   * How many thread turns this host runs at once, a whole number from 1 to
   * `MAX_CONCURRENT_RUNS_LIMIT`. Turns beyond it wait in order (see scheduling/).
   */
  MAX_CONCURRENT_RUNS: "max_concurrent_runs",
  /**
   * Whether the host looks for a newer release once a day and shows a notice. "true" or
   * "false"; on by default. It never installs anything by itself.
   */
  UPDATE_CHECK: "update_check",
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  [SettingKey.AGENT_CLI_AUTO_UPDATE]: "false",
  [SettingKey.AGENT_CLI_CHECK_INTERVAL]: String(DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES),
  [SettingKey.AGENT_CLI_SKIP_PERMISSIONS]: "false",
  [SettingKey.CHAT_GLOBAL_INSTRUCTIONS]: "",
  [SettingKey.DISPLAY_NAME]: "",
  [SettingKey.MAX_CONCURRENT_RUNS]: String(DEFAULT_MAX_CONCURRENT_RUNS),
  [SettingKey.UPDATE_CHECK]: "true",
};

export const VALID_KEYS: SettingKey[] = Object.values(SettingKey);

/**
 * Keys a paired device may read but not write: they lower a guard on the host itself. The
 * single-key route is the owner's in auth/route-policy.ts; settings/routes.ts refuses them in a
 * bulk write from anyone else.
 */
export const OWNER_ONLY_SETTING_KEYS: readonly SettingKey[] = [
  SettingKey.AGENT_CLI_SKIP_PERMISSIONS,
];

export const isOwnerOnlySettingKey = (key: string): boolean =>
  OWNER_ONLY_SETTING_KEYS.includes(key as SettingKey);

export const isValidSettingKey = (key: string): key is SettingKey => {
  return VALID_KEYS.includes(key as SettingKey);
};

const BOOLEAN_KEYS: readonly SettingKey[] = [
  SettingKey.UPDATE_CHECK,
  SettingKey.AGENT_CLI_AUTO_UPDATE,
  SettingKey.AGENT_CLI_SKIP_PERMISSIONS,
];

/** Why `value` cannot be saved under `key`, or null when it can. Free-text keys take any value. */
export const validateSettingValue = (key: SettingKey, value: string): string | null => {
  if (key === SettingKey.MAX_CONCURRENT_RUNS && parseMaxConcurrentRuns(value) === null) {
    return `${key} must be a whole number from 1 to ${MAX_CONCURRENT_RUNS_LIMIT}`;
  }
  if (key === SettingKey.AGENT_CLI_CHECK_INTERVAL && parseAgentCliCheckInterval(value) === null) {
    return `${key} must be a whole number of minutes from 0 to ${MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES}`;
  }
  if (BOOLEAN_KEYS.includes(key) && value !== "true" && value !== "false") {
    return `${key} must be "true" or "false"`;
  }
  return null;
};
