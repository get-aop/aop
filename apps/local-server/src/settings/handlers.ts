import type { LocalServerContext } from "../context.ts";
import {
  DEFAULT_SETTINGS,
  isValidSettingKey,
  SettingKey,
  VALID_KEYS,
  validateSettingValue,
} from "./types.ts";

export type InvalidKeyError = {
  code: "INVALID_KEY";
  key: string;
  validKeys: SettingKey[];
};

export type InvalidValueError = {
  code: "INVALID_VALUE";
  key: SettingKey;
  message: string;
};

export type GetSettingResult =
  | { success: true; key: string; value: string }
  | { success: false; error: InvalidKeyError };

export type GetAllSettingsResult = {
  success: true;
  settings: Array<{ key: string; value: string }>;
};

export type SetSettingResult =
  | { success: true; key: string; value: string }
  | { success: false; error: InvalidKeyError | InvalidValueError };

export type SetAllSettingsResult =
  | { success: true; settings: Array<{ key: string; value: string }> }
  | { success: false; error: InvalidKeyError | InvalidValueError };

/** What the rest of the server does once a setting it depends on has been saved. */
export interface SettingsEffects {
  /** The host's run cap was saved: turns waiting for a slot may start now. */
  runCapChanged?: () => Promise<void>;
}

export const getSetting = async (
  ctx: LocalServerContext,
  key: string,
): Promise<GetSettingResult> => {
  if (!isValidSettingKey(key)) return invalidKey(key);

  return { success: true, key, value: await ctx.settingsRepository.get(key) };
};

export const getAllSettings = async (ctx: LocalServerContext): Promise<GetAllSettingsResult> => {
  const dbSettings = await ctx.settingsRepository.getAll();
  const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

  const settings = VALID_KEYS.map((key) => ({
    key,
    value: settingsMap.get(key) ?? DEFAULT_SETTINGS[key],
  }));

  return { success: true, settings };
};

export const setSetting = async (
  ctx: LocalServerContext,
  key: string,
  value: string,
  effects: SettingsEffects = {},
): Promise<SetSettingResult> => {
  if (!isValidSettingKey(key)) return invalidKey(key);
  const invalid = invalidValue(key, value);
  if (invalid) return invalid;

  await ctx.settingsRepository.set(key, value);
  await announce(effects, [key]);
  return { success: true, key, value };
};

export const setAllSettings = async (
  ctx: LocalServerContext,
  entries: Array<{ key: string; value: string }>,
  effects: SettingsEffects = {},
): Promise<SetAllSettingsResult> => {
  const unknown = entries.find((entry) => !isValidSettingKey(entry.key));
  if (unknown) return invalidKey(unknown.key);

  const validated = entries as Array<{ key: SettingKey; value: string }>;
  for (const { key, value } of validated) {
    const invalid = invalidValue(key, value);
    if (invalid) return invalid;
  }
  await ctx.settingsRepository.setAll(validated);
  await announce(
    effects,
    validated.map(({ key }) => key),
  );
  return { success: true, settings: validated };
};

const announce = async (effects: SettingsEffects, keys: SettingKey[]): Promise<void> => {
  if (keys.includes(SettingKey.MAX_CONCURRENT_RUNS)) await effects.runCapChanged?.();
};

const invalidKey = (key: string): { success: false; error: InvalidKeyError } => ({
  success: false,
  error: { code: "INVALID_KEY", key, validKeys: VALID_KEYS },
});

const invalidValue = (
  key: SettingKey,
  value: string,
): { success: false; error: InvalidValueError } | null => {
  const message = validateSettingValue(key, value);
  return message ? { success: false, error: { code: "INVALID_VALUE", key, message } } : null;
};
