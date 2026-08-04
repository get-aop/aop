import type { LocalServerContext } from "../context.ts";
import { resolveLinearCallbackUrl } from "../context.ts";
import {
  DEFAULT_SETTINGS,
  isSecretSettingKey,
  isValidSettingKey,
  MASKED_SECRET_SETTING_VALUE,
  SettingKey,
  VALID_KEYS,
} from "./types.ts";

export type GetSettingResult =
  | { success: true; key: string; value: string }
  | { success: false; error: GetSettingError };

export type GetSettingError = {
  code: "INVALID_KEY";
  key: string;
  validKeys: SettingKey[];
};

export type GetAllSettingsResult = {
  success: true;
  settings: Array<{ key: string; value: string }>;
};

export type SetSettingResult =
  | { success: true; key: string; value: string }
  | { success: false; error: SetSettingError };

export type SetSettingError =
  | { code: "INVALID_KEY"; key: string; validKeys: SettingKey[] }
  | { code: "INVALID_VALUE"; key: string; value: string; validValues: readonly string[] }
  | { code: "READONLY_KEY"; key: string };

export const getSetting = async (
  ctx: LocalServerContext,
  key: string,
): Promise<GetSettingResult> => {
  if (!isValidSettingKey(key)) {
    return {
      success: false,
      error: { code: "INVALID_KEY", key, validKeys: VALID_KEYS },
    };
  }

  const value = await ctx.settingsRepository.get(key);
  return { success: true, key, value: normalizeSettingValue(key, value) };
};

export const getAllSettings = async (ctx: LocalServerContext): Promise<GetAllSettingsResult> => {
  const dbSettings = await ctx.settingsRepository.getAll();
  const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

  const settings = VALID_KEYS.map((key) => ({
    key,
    value: normalizeSettingValue(key, settingsMap.get(key) ?? DEFAULT_SETTINGS[key]),
  }));

  return { success: true, settings };
};

const validateSettingValue = async (
  _ctx: LocalServerContext,
  key: SettingKey,
  value: string,
  _pendingValues?: Map<SettingKey, string>,
): Promise<SetSettingError | null> => {
  const urlError = validateUrlSetting(key, value);
  if (urlError) {
    return urlError;
  }

  return validateChatBehaviorSetting(key, value);
};

const validateChatBehaviorSetting = (key: SettingKey, value: string): SetSettingError | null => {
  if (key === SettingKey.CHAT_MID_RUN_MODE) {
    if (value !== "queue" && value !== "steer") {
      return {
        code: "INVALID_VALUE",
        key,
        value,
        validValues: ["queue", "steer"],
      };
    }
    return null;
  }

  return null;
};

const validateUrlSetting = (key: SettingKey, value: string): SetSettingError | null => {
  if (key === SettingKey.LINEAR_CALLBACK_URL) {
    return validateAbsoluteUrl(key, value, [
      "A valid absolute URL like http://127.0.0.1:25150/api/linear/callback",
    ]);
  }

  if (key === SettingKey.JIRA_SITE_URL) {
    return validateJiraSiteUrl(key, value);
  }

  return null;
};

const validateAbsoluteUrl = (
  key: SettingKey,
  value: string,
  validValues: readonly string[],
): SetSettingError | null => {
  if (value.length === 0) {
    return null;
  }

  try {
    new URL(value);
    return null;
  } catch {
    return {
      code: "INVALID_VALUE",
      key,
      value,
      validValues,
    };
  }
};

const validateJiraSiteUrl = (key: SettingKey, value: string): SetSettingError | null => {
  if (value.length === 0 || isTrustedJiraCloudSiteUrl(value)) {
    return null;
  }

  return {
    code: "INVALID_VALUE",
    key,
    value,
    validValues: ["A valid Jira Cloud URL like https://example.atlassian.net"],
  };
};

const isTrustedJiraCloudSiteUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      hostname.endsWith(".atlassian.net") &&
      hostname !== "atlassian.net" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.port.length === 0
    );
  } catch {
    return false;
  }
};

const normalizeSettingValue = (key: SettingKey, value: string): string => {
  if (isSecretSettingKey(key)) {
    return value.trim().length > 0 ? MASKED_SECRET_SETTING_VALUE : "";
  }

  if (key === SettingKey.CHAT_MID_RUN_MODE) {
    return "queue";
  }

  if (key !== SettingKey.LINEAR_CALLBACK_URL) {
    return value;
  }

  return resolveLinearCallbackUrl({
    configuredCallbackUrl: value,
    env: process.env,
  });
};

export const setSetting = async (
  ctx: LocalServerContext,
  key: string,
  value: string,
): Promise<SetSettingResult> => {
  if (!isValidSettingKey(key)) {
    return {
      success: false,
      error: { code: "INVALID_KEY", key, validKeys: VALID_KEYS },
    };
  }

  const valueError = await validateSettingValue(ctx, key, value);
  if (valueError) {
    return { success: false, error: valueError };
  }

  const storedValue = normalizeStoredSettingValue(key, value);
  if (!isMaskedSecretWrite(key, value)) {
    await ctx.settingsRepository.set(key, storedValue);
  }

  return { success: true, key, value: normalizeWriteResponseValue(key, storedValue) };
};

export type SetAllSettingsResult =
  | { success: true; settings: Array<{ key: string; value: string }> }
  | { success: false; error: SetSettingError };

export const setAllSettings = async (
  ctx: LocalServerContext,
  entries: Array<{ key: string; value: string }>,
): Promise<SetAllSettingsResult> => {
  const pendingValues = new Map<SettingKey, string>();

  for (const entry of entries) {
    if (!isValidSettingKey(entry.key)) {
      return {
        success: false,
        error: { code: "INVALID_KEY", key: entry.key, validKeys: VALID_KEYS },
      };
    }
    pendingValues.set(entry.key, entry.value);
  }

  for (const entry of entries) {
    const valueError = await validateSettingValue(
      ctx,
      entry.key as SettingKey,
      entry.value,
      pendingValues,
    );
    if (valueError) {
      return { success: false, error: valueError };
    }
  }

  const validated = entries as Array<{ key: SettingKey; value: string }>;
  const stored = validated.map((entry) => ({
    key: entry.key,
    value: normalizeStoredSettingValue(entry.key, entry.value),
  }));
  await ctx.settingsRepository.setAll(
    validated
      .filter((entry) => !isMaskedSecretWrite(entry.key, entry.value))
      .map((entry) => ({
        key: entry.key,
        value: normalizeStoredSettingValue(entry.key, entry.value),
      })),
  );
  return {
    success: true,
    settings: stored.map((entry) => ({
      key: entry.key,
      value: normalizeWriteResponseValue(entry.key, entry.value),
    })),
  };
};

const normalizeStoredSettingValue = (key: SettingKey, value: string): string =>
  key === SettingKey.CHAT_MID_RUN_MODE ? "queue" : value;

const normalizeWriteResponseValue = (key: SettingKey, value: string): string =>
  isSecretSettingKey(key) ? normalizeSettingValue(key, value) : value;

const isMaskedSecretWrite = (key: SettingKey, value: string): boolean => {
  return isSecretSettingKey(key) && value === MASKED_SECRET_SETTING_VALUE;
};

export const checkDbConnection = async (ctx: LocalServerContext): Promise<boolean> => {
  try {
    await ctx.settingsRepository.get("max_concurrent_tasks");
    return true;
  } catch {
    return false;
  }
};
