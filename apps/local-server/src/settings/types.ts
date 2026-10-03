import {
  BUILT_IN_RUNTIME_ID,
  buildChannel,
  DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  DEFAULT_LIVE_VIEW_MODE,
  DEFAULT_MAX_CONCURRENT_RUNS,
  DEFAULT_ROUTINE_MAX_ACTIVE,
  DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES,
  INBOX_DEFAULTS,
  LIBRARY_CAP_MB_MAX,
  LIBRARY_DEFAULTS,
  LIBRARY_RETENTION_DAYS_MAX,
  LiveViewModeSchema,
  MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  MAX_CONCURRENT_RUNS_LIMIT,
  MAX_ROUTINE_MAX_ACTIVE,
  MAX_ROUTINE_MIN_INTERVAL_MINUTES,
  parseAgentCliCheckInterval,
  parseLibraryCapMb,
  parseLibraryRetentionDays,
  parseMaxConcurrentRuns,
  parseRoutineMaxActive,
  parseRoutineMinInterval,
  RuntimeIdSchema,
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
   * Days the Inbox keeps a matched message after its last activity, 0 keeping it (see
   * inbox/retention.ts). Linked items past it keep their links and lose their text.
   */
  INBOX_RETENTION_DAYS: "inbox_retention_days",
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
  [SettingKey.DEFAULT_RUNTIME]: BUILT_IN_RUNTIME_ID,
  [SettingKey.DISPLAY_NAME]: "",
  [SettingKey.INBOX_RETENTION_DAYS]: String(INBOX_DEFAULTS.retentionDays),
  [SettingKey.LIBRARY_RETENTION_DAYS]: String(LIBRARY_DEFAULTS.retentionDays),
  [SettingKey.LIBRARY_PROJECT_CAP_MB]: String(LIBRARY_DEFAULTS.projectCapMb),
  [SettingKey.LIBRARY_HOST_CAP_MB]: String(LIBRARY_DEFAULTS.hostCapMb),
  [SettingKey.LIVE_VIEW]: DEFAULT_LIVE_VIEW_MODE,
  [SettingKey.MAX_CONCURRENT_RUNS]: String(DEFAULT_MAX_CONCURRENT_RUNS),
  [SettingKey.ROUTINE_MAX_ACTIVE]: String(DEFAULT_ROUTINE_MAX_ACTIVE),
  [SettingKey.ROUTINE_MIN_INTERVAL]: String(DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES),
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
  SettingKey.ROUTINE_MAX_ACTIVE,
  SettingKey.ROUTINE_MIN_INTERVAL,
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
    // The Inbox keeps the Library's range of days.
    keys: [SettingKey.LIBRARY_RETENTION_DAYS, SettingKey.INBOX_RETENTION_DAYS],
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
