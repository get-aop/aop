import { useEffect, useSyncExternalStore } from "react";
import { getSettings, type SettingEntry } from "../api/client";

export const DISPLAY_NAME_KEY = "display_name";

let current = "";
let asked = false;
const listeners = new Set<() => void>();

/**
 * The host owner's name as Settings holds it, "" when none is set. The host is asked once per
 * page load, by the first screen that needs it; a save in Settings reaches every screen at once.
 */
export const useDisplayName = (): string => {
  useEffect(() => {
    if (asked) return;
    asked = true;
    void load();
  }, []);
  return useSyncExternalStore(subscribe, () => current);
};

/** Hears what Settings just saved, so a new name shows without asking the host again. */
export const noteSavedSettings = (settings: readonly SettingEntry[]): void => {
  const saved = settings.find((setting) => setting.key === DISPLAY_NAME_KEY);
  if (saved === undefined || saved.value === current) return;
  current = saved.value;
  for (const listener of listeners) listener();
};

const load = async (): Promise<void> => {
  try {
    noteSavedSettings(await getSettings());
  } catch {
    // The host did not answer: greet no one by name, and ask again on the next screen that needs it.
    asked = false;
  }
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
