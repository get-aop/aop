import {
  DEFAULT_MAX_CONCURRENT_RUNS,
  MAX_CONCURRENT_RUNS_LIMIT,
  parseMaxConcurrentRuns,
} from "@aop/common";
import type { Setting } from "../db/schema.ts";

export type { Setting };

/** Only keys that live code reads. A key is added with its first reader, not before. */
export const SettingKey = {
  /** JSON array of ExecHostConfig — SSH execution hosts (not a secret; keys stay in ~/.ssh). */
  REMOTE_EXEC_HOSTS: "remote_exec_hosts_json",
  /**
   * Optional free-text preferences injected into every chat runtime prompt
   * (not stored in the visible message transcript).
   */
  CHAT_GLOBAL_INSTRUCTIONS: "chat_global_instructions",
  /**
   * How many thread turns this host runs at once, a whole number from 1 to
   * `MAX_CONCURRENT_RUNS_LIMIT`. Turns beyond it wait in order (see scheduling/).
   */
  MAX_CONCURRENT_RUNS: "max_concurrent_runs",
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  [SettingKey.REMOTE_EXEC_HOSTS]: "",
  [SettingKey.CHAT_GLOBAL_INSTRUCTIONS]: "",
  [SettingKey.MAX_CONCURRENT_RUNS]: String(DEFAULT_MAX_CONCURRENT_RUNS),
};

export const VALID_KEYS: SettingKey[] = Object.values(SettingKey);

export const isValidSettingKey = (key: string): key is SettingKey => {
  return VALID_KEYS.includes(key as SettingKey);
};

/** Why `value` cannot be saved under `key`, or null when it can. Free-text keys take any value. */
export const validateSettingValue = (key: SettingKey, value: string): string | null => {
  if (key === SettingKey.MAX_CONCURRENT_RUNS && parseMaxConcurrentRuns(value) === null) {
    return `${key} must be a whole number from 1 to ${MAX_CONCURRENT_RUNS_LIMIT}`;
  }
  return null;
};
