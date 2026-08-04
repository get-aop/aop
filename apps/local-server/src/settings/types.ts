import type { Setting } from "../db/schema.ts";

export type { Setting };

export const SettingKey = {
  MAX_CONCURRENT_TASKS: "max_concurrent_tasks",
  WATCHER_POLL_INTERVAL_SECS: "watcher_poll_interval_secs",
  QUEUE_POLL_INTERVAL_SECS: "queue_poll_interval_secs",
  AGENT_TIMEOUT_SECS: "agent_timeout_secs",
  FAST_MODE: "fast_mode",
  LINEAR_CLIENT_ID: "linear_client_id",
  LINEAR_CALLBACK_URL: "linear_callback_url",
  JIRA_SITE_URL: "jira_site_url",
  JIRA_EMAIL: "jira_email",
  JIRA_API_TOKEN: "jira_api_token",
  JIRA_CLIENT_ID: "jira_client_id",
  JIRA_CLIENT_SECRET: "jira_client_secret",
  JIRA_CALLBACK_URL: "jira_callback_url",
  GITHUB_APP_ID: "github_app_id",
  GITHUB_APP_PRIVATE_KEY: "github_app_private_key",
  GITHUB_APP_INSTALLATION_ID: "github_app_installation_id",
  GITHUB_APP_ACCOUNT_LOGIN: "github_app_account_login",
  GITHUB_APP_USER_LOGIN: "github_app_user_login",
  LICENSE_KEY: "license_key",
  LICENSE_ENTITLEMENT: "license_entitlement_json",
  LICENSE_MACHINE_ID: "license_machine_id",
  LICENSE_SERVER_URL: "license_server_url",
  LICENSE_VALIDATED_AT: "license_validated_at",
  LICENSE_LEMON_INSTANCE_ID: "license_lemon_instance_id",
  /** JSON array of ExecHostConfig — SSH execution hosts (not a secret; keys stay in ~/.ssh). */
  REMOTE_EXEC_HOSTS: "remote_exec_hosts_json",
  DISCOVER_LEGACY_REPO_TASKS: "discover_legacy_repo_tasks",
  BUDGET_WALL_CLOCK_SECS: "budget_wall_clock_secs",
  BUDGET_COST_USD: "budget_cost_usd",
  BUDGET_TOTAL_TOKENS: "budget_total_tokens",
  SCHEDULER_ENABLED: "scheduler_enabled",
  SCHEDULER_POLL_INTERVAL_SECS: "scheduler_poll_interval_secs",
  HANDOFF_REQUIRES_APPROVAL: "handoff_requires_approval",
  /**
   * Compatibility key for mid-run chat behavior. New messages always queue;
   * legacy "steer" values are accepted and normalized to "queue".
   */
  CHAT_MID_RUN_MODE: "chat_mid_run_mode",
  /**
   * Optional free-text preferences injected into every chat runtime prompt
   * (not stored in the visible message transcript).
   */
  CHAT_GLOBAL_INSTRUCTIONS: "chat_global_instructions",
} as const;

export const CHAT_MID_RUN_MODES = ["queue", "steer"] as const;
export type ChatMidRunMode = (typeof CHAT_MID_RUN_MODES)[number];
export const isChatMidRunMode = (value: unknown): value is ChatMidRunMode =>
  typeof value === "string" && (CHAT_MID_RUN_MODES as readonly string[]).includes(value);

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  [SettingKey.MAX_CONCURRENT_TASKS]: "5",
  [SettingKey.WATCHER_POLL_INTERVAL_SECS]: "30",
  [SettingKey.QUEUE_POLL_INTERVAL_SECS]: "1",
  [SettingKey.AGENT_TIMEOUT_SECS]: "1800",
  [SettingKey.FAST_MODE]: "false",
  [SettingKey.LINEAR_CLIENT_ID]: "",
  [SettingKey.LINEAR_CALLBACK_URL]: "",
  [SettingKey.JIRA_SITE_URL]: "",
  [SettingKey.JIRA_EMAIL]: "",
  [SettingKey.JIRA_API_TOKEN]: "",
  [SettingKey.JIRA_CLIENT_ID]: "",
  [SettingKey.JIRA_CLIENT_SECRET]: "",
  [SettingKey.JIRA_CALLBACK_URL]: "",
  [SettingKey.GITHUB_APP_ID]: "",
  [SettingKey.GITHUB_APP_PRIVATE_KEY]: "",
  [SettingKey.GITHUB_APP_INSTALLATION_ID]: "",
  [SettingKey.GITHUB_APP_ACCOUNT_LOGIN]: "",
  [SettingKey.GITHUB_APP_USER_LOGIN]: "",
  [SettingKey.LICENSE_KEY]: "",
  [SettingKey.LICENSE_ENTITLEMENT]: "",
  [SettingKey.LICENSE_MACHINE_ID]: "",
  [SettingKey.LICENSE_SERVER_URL]: "",
  [SettingKey.LICENSE_VALIDATED_AT]: "",
  [SettingKey.LICENSE_LEMON_INSTANCE_ID]: "",
  [SettingKey.REMOTE_EXEC_HOSTS]: "",
  [SettingKey.DISCOVER_LEGACY_REPO_TASKS]: "false",
  [SettingKey.BUDGET_WALL_CLOCK_SECS]: "0",
  [SettingKey.BUDGET_COST_USD]: "0",
  [SettingKey.BUDGET_TOTAL_TOKENS]: "0",
  [SettingKey.SCHEDULER_ENABLED]: "false",
  [SettingKey.SCHEDULER_POLL_INTERVAL_SECS]: "60",
  [SettingKey.HANDOFF_REQUIRES_APPROVAL]: "false",
  [SettingKey.CHAT_MID_RUN_MODE]: "queue",
  [SettingKey.CHAT_GLOBAL_INSTRUCTIONS]: "",
};

export const VALID_KEYS: SettingKey[] = Object.values(SettingKey);
export const MASKED_SECRET_SETTING_VALUE = "********";

const SECRET_SETTING_KEYS: readonly SettingKey[] = [
  SettingKey.JIRA_API_TOKEN,
  SettingKey.JIRA_CLIENT_SECRET,
  SettingKey.GITHUB_APP_PRIVATE_KEY,
  SettingKey.LICENSE_KEY,
];

export const isValidSettingKey = (key: string): key is SettingKey => {
  return VALID_KEYS.includes(key as SettingKey);
};

export const isSecretSettingKey = (key: SettingKey): boolean => {
  return SECRET_SETTING_KEYS.includes(key);
};

const LICENSE_MANAGED_SETTING_KEYS: readonly SettingKey[] = [
  SettingKey.LICENSE_KEY,
  SettingKey.LICENSE_ENTITLEMENT,
  SettingKey.LICENSE_MACHINE_ID,
  SettingKey.LICENSE_VALIDATED_AT,
  SettingKey.LICENSE_LEMON_INSTANCE_ID,
];

/** License fields are written only by `/api/license/*`, not generic settings saves. */
export const isLicenseManagedSettingKey = (key: SettingKey): boolean =>
  LICENSE_MANAGED_SETTING_KEYS.includes(key);
