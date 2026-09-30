import type { LocalServerContext } from "../context.ts";
import { DEFAULT_SETTINGS, isValidSettingKey, type SettingKey, VALID_KEYS } from "./types.ts";

export type InvalidKeyError = {
  code: "INVALID_KEY";
  key: string;
  validKeys: SettingKey[];
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
  | { success: false; error: InvalidKeyError };

export type SetAllSettingsResult =
  | { success: true; settings: Array<{ key: string; value: string }> }
  | { success: false; error: InvalidKeyError };

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
): Promise<SetSettingResult> => {
  if (!isValidSettingKey(key)) return invalidKey(key);

  await ctx.settingsRepository.set(key, value);
  return { success: true, key, value };
};

export const setAllSettings = async (
  ctx: LocalServerContext,
  entries: Array<{ key: string; value: string }>,
): Promise<SetAllSettingsResult> => {
  const unknown = entries.find((entry) => !isValidSettingKey(entry.key));
  if (unknown) return invalidKey(unknown.key);

  const validated = entries as Array<{ key: SettingKey; value: string }>;
  await ctx.settingsRepository.setAll(validated);
  return { success: true, settings: validated };
};

const invalidKey = (key: string): { success: false; error: InvalidKeyError } => ({
  success: false,
  error: { code: "INVALID_KEY", key, validKeys: VALID_KEYS },
});
