import {
  buildChannel,
  DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  DEFAULT_MAX_CONCURRENT_RUNS,
  LIBRARY_CAP_MB_MAX,
  LIBRARY_DEFAULTS,
  LIBRARY_RETENTION_DAYS_MAX,
  MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  MAX_CONCURRENT_RUNS_LIMIT,
  parseAgentCliCheckInterval,
  parseLibraryCapMb,
  parseLibraryRetentionDays,
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
   * The Library's host-wide defaults (see library/retention.ts). Days an automatic item (a chat
   * attachment, an agent's artifact) stays, 0 keeping it; a project may set its own.
   */
  LIBRARY_RETENTION_DAYS: "library_retention_days",
  /** MB a project's Library may hold before its least recently used automatic items go; 0 is no cap. */
  LIBRARY_PROJECT_CAP_MB: "library_project_cap_mb",
  /** MB every project's Library together may hold, enforced the same way; 0 is no cap. */
  LIBRARY_HOST_CAP_MB: "library_host_cap_mb",
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
  /**
   * Whether AOP Nightly installs a newer nightly by itself once no turn is running. "true" or
   * "false"; on by default in a nightly build. Only a nightly host reads it: a stable host never
   * installs a release without the owner (docs/NIGHTLY.md).
   */
  UPDATE_AUTO_APPLY: "update_auto_apply",
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  [SettingKey.AGENT_CLI_AUTO_UPDATE]: "false",
  [SettingKey.AGENT_CLI_CHECK_INTERVAL]: String(DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES),
  [SettingKey.AGENT_CLI_SKIP_PERMISSIONS]: "false",
  [SettingKey.CHAT_GLOBAL_INSTRUCTIONS]: "",
  [SettingKey.DISPLAY_NAME]: "",
  [SettingKey.LIBRARY_RETENTION_DAYS]: String(LIBRARY_DEFAULTS.retentionDays),
  [SettingKey.LIBRARY_PROJECT_CAP_MB]: String(LIBRARY_DEFAULTS.projectCapMb),
  [SettingKey.LIBRARY_HOST_CAP_MB]: String(LIBRARY_DEFAULTS.hostCapMb),
  [SettingKey.MAX_CONCURRENT_RUNS]: String(DEFAULT_MAX_CONCURRENT_RUNS),
  [SettingKey.UPDATE_CHECK]: "true",
  [SettingKey.UPDATE_AUTO_APPLY]: buildChannel().id === "nightly" ? "true" : "false",
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
  SettingKey.UPDATE_AUTO_APPLY,
  SettingKey.AGENT_CLI_AUTO_UPDATE,
  SettingKey.AGENT_CLI_SKIP_PERMISSIONS,
];

const LIBRARY_CAP_KEYS: readonly SettingKey[] = [
  SettingKey.LIBRARY_PROJECT_CAP_MB,
  SettingKey.LIBRARY_HOST_CAP_MB,
];

/** Why `value` cannot be saved under `key`, or null when it can. Free-text keys take any value. */
export const validateSettingValue = (key: SettingKey, value: string): string | null => {
  if (key === SettingKey.MAX_CONCURRENT_RUNS && parseMaxConcurrentRuns(value) === null) {
    return `${key} must be a whole number from 1 to ${MAX_CONCURRENT_RUNS_LIMIT}`;
  }
  if (key === SettingKey.AGENT_CLI_CHECK_INTERVAL && parseAgentCliCheckInterval(value) === null) {
    return `${key} must be a whole number of minutes from 0 to ${MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES}`;
  }
  if (key === SettingKey.LIBRARY_RETENTION_DAYS && parseLibraryRetentionDays(value) === null) {
    return `${key} must be a whole number of days from 0 to ${LIBRARY_RETENTION_DAYS_MAX}`;
  }
  if (LIBRARY_CAP_KEYS.includes(key) && parseLibraryCapMb(value) === null) {
    return `${key} must be a whole number of MB from 0 to ${LIBRARY_CAP_MB_MAX}`;
  }
  if (BOOLEAN_KEYS.includes(key) && value !== "true" && value !== "false") {
    return `${key} must be "true" or "false"`;
  }
  return null;
};
