import {
  BUILT_IN_RUNTIME_ID,
  buildChannel,
  DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  DEFAULT_HOST_MANAGEMENT,
  DEFAULT_LIVE_VIEW_MODE,
  DEFAULT_MAX_CONCURRENT_RUNS,
  DEFAULT_ROUTINE_MAX_ACTIVE,
  DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES,
  DEFAULT_UPDATE_INSTALL_WINDOW,
  HostManagementSchema,
  LIBRARY_CAP_MB_MAX,
  LIBRARY_DEFAULTS,
  LIBRARY_RETENTION_DAYS_MAX,
  LiveViewModeSchema,
  MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  MAX_CONCURRENT_RUNS_LIMIT,
  MAX_ROUTINE_MAX_ACTIVE,
  MAX_ROUTINE_MIN_INTERVAL_MINUTES,
  parseAgentCliCheckInterval,
  parseInstallWindow,
  parseLibraryCapMb,
  parseLibraryRetentionDays,
  parseMaxConcurrentRuns,
  parseRoutineMaxActive,
  parseRoutineMinInterval,
  RuntimeIdSchema,
  UpdateInstallModeSchema,
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
   * The runtime configuration a new project's coordinator and threads start on, and the one a
   * role falls back to when the runtime its project names is gone (see project/runtime.ts). A
   * runtime configuration id; `claude-code`, the built-in one, by default. Set through
   * PUT /api/runtime-configuration/default, which checks the runtime exists.
   */
  DEFAULT_RUNTIME: "default_runtime_id",
  /**
   * What the host owner is called, for the dashboard to greet them by. Free text; empty (the
   * default) greets no one by name.
   */
  DISPLAY_NAME: "display_name",
  /**
   * Who may manage this host: update it and its agent CLIs, change the update settings
   * (`MANAGER_SETTING_KEYS`), and pair or revoke devices. "devices" (the default: the host machine
   * and every paired device) or "owner" (the host machine only). Only the host owner may change it
   * (`OWNER_ONLY_SETTING_KEYS`); see auth/route-policy.ts.
   */
  HOST_MANAGEMENT: "host_management",
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
   * When the dashboard shows the live view of the host's screen while a thread uses CUA:
   * "off", "remote" (only to a paired device, the default) or "always" (see computer-use/live-view.ts).
   */
  LIVE_VIEW: "live_view",
  /**
   * How many thread turns this host runs at once, a whole number from 1 to
   * `MAX_CONCURRENT_RUNS_LIMIT`. Turns beyond it wait in order (see scheduling/).
   */
  MAX_CONCURRENT_RUNS: "max_concurrent_runs",
  /**
   * How many routines of one project may be enabled at once, a whole number from 1 to
   * `MAX_ROUTINE_MAX_ACTIVE`. Only the host owner may change it (`OWNER_ONLY_SETTING_KEYS`).
   */
  ROUTINE_MAX_ACTIVE: "routine_max_active_per_project",
  /**
   * The shortest gap, in minutes, a routine's schedule may leave between runs (see routine/).
   * Only the host owner may lower it (`OWNER_ONLY_SETTING_KEYS`), so a coordinator or a paired
   * device cannot set a routine running every minute.
   */
  ROUTINE_MIN_INTERVAL: "routine_min_interval_minutes",
  /**
   * Whether the host looks for a newer release (daily on Stable, hourly on Nightly) and shows it.
   * "true" or "false"; on by default. Off, nothing is checked, downloaded or installed by itself.
   * Written by whoever may manage the host (`MANAGER_SETTING_KEYS`), as are the other update keys.
   */
  UPDATE_CHECK: "update_check",
  /**
   * Whether the host downloads and checks a newer release ahead of time, without installing it, so
   * "Update host" only has to swap and restart (update/background-download.ts). "true" or "false";
   * on by default.
   */
  UPDATE_BACKGROUND_DOWNLOAD: "update_background_download",
  /**
   * When the host installs a newer release by itself (`UpdateInstallMode`): "ask" never (a person
   * does, from the Updates button; the default on Stable), "idle" once the turns running when it
   * found the release have finished (the default on Nightly), "window" the same but only between
   * the `update_install_window` hours (update/install-policy.ts). Hosts that had the older
   * `update_auto_apply` keep their choice (db/update-install-v27.ts).
   */
  UPDATE_INSTALL: "update_install",
  /** The hours of `update_install` "window": `HH:MM-HH:MM`, host time, wrapping past midnight. */
  UPDATE_INSTALL_WINDOW: "update_install_window",
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  [SettingKey.AGENT_CLI_AUTO_UPDATE]: "false",
  [SettingKey.AGENT_CLI_CHECK_INTERVAL]: String(DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES),
  [SettingKey.AGENT_CLI_SKIP_PERMISSIONS]: "false",
  [SettingKey.CHAT_GLOBAL_INSTRUCTIONS]: "",
  [SettingKey.DEFAULT_RUNTIME]: BUILT_IN_RUNTIME_ID,
  [SettingKey.DISPLAY_NAME]: "",
  [SettingKey.HOST_MANAGEMENT]: DEFAULT_HOST_MANAGEMENT,
  [SettingKey.LIBRARY_RETENTION_DAYS]: String(LIBRARY_DEFAULTS.retentionDays),
  [SettingKey.LIBRARY_PROJECT_CAP_MB]: String(LIBRARY_DEFAULTS.projectCapMb),
  [SettingKey.LIBRARY_HOST_CAP_MB]: String(LIBRARY_DEFAULTS.hostCapMb),
  [SettingKey.LIVE_VIEW]: DEFAULT_LIVE_VIEW_MODE,
  [SettingKey.MAX_CONCURRENT_RUNS]: String(DEFAULT_MAX_CONCURRENT_RUNS),
  [SettingKey.ROUTINE_MAX_ACTIVE]: String(DEFAULT_ROUTINE_MAX_ACTIVE),
  [SettingKey.ROUTINE_MIN_INTERVAL]: String(DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES),
  [SettingKey.UPDATE_CHECK]: "true",
  [SettingKey.UPDATE_BACKGROUND_DOWNLOAD]: "true",
  [SettingKey.UPDATE_INSTALL]: buildChannel().id === "nightly" ? "idle" : "ask",
  [SettingKey.UPDATE_INSTALL_WINDOW]: DEFAULT_UPDATE_INSTALL_WINDOW,
};

export const VALID_KEYS: SettingKey[] = Object.values(SettingKey);

/**
 * Keys a paired device may read but not write: they lower a guard on the host itself. The
 * single-key route is the owner's in auth/route-policy.ts; settings/routes.ts refuses them in a
 * bulk write from anyone else.
 */
export const OWNER_ONLY_SETTING_KEYS: readonly SettingKey[] = [
  SettingKey.AGENT_CLI_SKIP_PERMISSIONS,
  SettingKey.HOST_MANAGEMENT,
  SettingKey.ROUTINE_MAX_ACTIVE,
  SettingKey.ROUTINE_MIN_INTERVAL,
];

export const isOwnerOnlySettingKey = (key: string): boolean =>
  OWNER_ONLY_SETTING_KEYS.includes(key as SettingKey);

/**
 * Keys that decide when the host updates itself and its agent CLIs: whoever may manage the host
 * (`HOST_MANAGEMENT`) writes them. Otherwise a device refused "Update host" could still switch on
 * the automatic install and have the host do it anyway.
 */
export const MANAGER_SETTING_KEYS: readonly SettingKey[] = [
  SettingKey.UPDATE_CHECK,
  SettingKey.UPDATE_INSTALL,
  SettingKey.UPDATE_INSTALL_WINDOW,
  SettingKey.UPDATE_BACKGROUND_DOWNLOAD,
  SettingKey.AGENT_CLI_AUTO_UPDATE,
  SettingKey.AGENT_CLI_CHECK_INTERVAL,
];

export const isManagerSettingKey = (key: string): boolean =>
  MANAGER_SETTING_KEYS.includes(key as SettingKey);

export const isValidSettingKey = (key: string): key is SettingKey => {
  return VALID_KEYS.includes(key as SettingKey);
};

const BOOLEAN_KEYS: readonly SettingKey[] = [
  SettingKey.UPDATE_CHECK,
  SettingKey.UPDATE_BACKGROUND_DOWNLOAD,
  SettingKey.AGENT_CLI_AUTO_UPDATE,
  SettingKey.AGENT_CLI_SKIP_PERMISSIONS,
];

const LIBRARY_CAP_KEYS: readonly SettingKey[] = [
  SettingKey.LIBRARY_PROJECT_CAP_MB,
  SettingKey.LIBRARY_HOST_CAP_MB,
];

/** Why `value` cannot be saved under `key`, or null when it can. Free-text keys take any value. */
export const validateSettingValue = (key: SettingKey, value: string): string | null => {
  for (const rule of VALUE_RULES) {
    if (rule.keys.includes(key) && !rule.valid(value)) return rule.message(key);
  }
  return null;
};

// What a setting must hold: the keys a rule covers, whether a value passes, and what to say if not.
const VALUE_RULES: readonly {
  keys: readonly SettingKey[];
  valid: (value: string) => boolean;
  message: (key: SettingKey) => string;
}[] = [
  {
    keys: [SettingKey.MAX_CONCURRENT_RUNS],
    valid: (value) => parseMaxConcurrentRuns(value) !== null,
    message: (key) => `${key} must be a whole number from 1 to ${MAX_CONCURRENT_RUNS_LIMIT}`,
  },
  {
    keys: [SettingKey.AGENT_CLI_CHECK_INTERVAL],
    valid: (value) => parseAgentCliCheckInterval(value) !== null,
    message: (key) =>
      `${key} must be a whole number of minutes from 0 to ${MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES}`,
  },
  {
    keys: [SettingKey.ROUTINE_MIN_INTERVAL],
    valid: (value) => parseRoutineMinInterval(value) !== null,
    message: (key) =>
      `${key} must be a whole number of minutes from 1 to ${MAX_ROUTINE_MIN_INTERVAL_MINUTES}`,
  },
  {
    keys: [SettingKey.ROUTINE_MAX_ACTIVE],
    valid: (value) => parseRoutineMaxActive(value) !== null,
    message: (key) => `${key} must be a whole number from 1 to ${MAX_ROUTINE_MAX_ACTIVE}`,
  },
  {
    keys: [SettingKey.LIBRARY_RETENTION_DAYS],
    valid: (value) => parseLibraryRetentionDays(value) !== null,
    message: (key) =>
      `${key} must be a whole number of days from 0 to ${LIBRARY_RETENTION_DAYS_MAX}`,
  },
  {
    keys: LIBRARY_CAP_KEYS,
    valid: (value) => parseLibraryCapMb(value) !== null,
    message: (key) => `${key} must be a whole number of MB from 0 to ${LIBRARY_CAP_MB_MAX}`,
  },
  {
    keys: [SettingKey.LIVE_VIEW],
    valid: (value) => LiveViewModeSchema.safeParse(value).success,
    message: (key) => `${key} must be "off", "remote" or "always"`,
  },
  {
    keys: [SettingKey.HOST_MANAGEMENT],
    valid: (value) => HostManagementSchema.safeParse(value).success,
    message: (key) => `${key} must be "devices" or "owner"`,
  },
  {
    keys: [SettingKey.UPDATE_INSTALL],
    valid: (value) => UpdateInstallModeSchema.safeParse(value).success,
    message: (key) => `${key} must be "ask", "idle" or "window"`,
  },
  {
    keys: [SettingKey.UPDATE_INSTALL_WINDOW],
    valid: (value) => parseInstallWindow(value) !== null,
    message: (key) => `${key} must be two different times as HH:MM-HH:MM, such as 01:00-06:00`,
  },
  {
    keys: [SettingKey.DEFAULT_RUNTIME],
    valid: (value) => RuntimeIdSchema.safeParse(value).success,
    message: (key) => `${key} must be a runtime configuration id`,
  },
  {
    keys: BOOLEAN_KEYS,
    valid: (value) => value === "true" || value === "false",
    message: (key) => `${key} must be "true" or "false"`,
  },
];
