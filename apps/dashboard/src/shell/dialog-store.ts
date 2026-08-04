import { useSyncExternalStore } from "react";

export type SettingsSection =
  | "general"
  | "repositories"
  | "runtimes"
  | "exec-hosts"
  | "workflows"
  | "about";

interface DialogState {
  settings: { open: boolean; section: SettingsSection };
  newSession: boolean;
  attachRepo: boolean;
}

let current: DialogState = {
  settings: { open: false, section: "general" },
  newSession: false,
  attachRepo: false,
};

const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setState = (patch: Partial<DialogState>): void => {
  current = { ...current, ...patch };
  emit();
};

export const useDialogs = (): DialogState => useSyncExternalStore(subscribe, () => current);

/** Non-hook accessor (tests, one-shot reads). */
export const getDialogs = (): DialogState => current;

export const openSettingsDialog = (section: SettingsSection = "general"): void =>
  setState({ settings: { open: true, section } });

export const closeSettingsDialog = (): void =>
  setState({ settings: { ...current.settings, open: false } });

export const openNewSessionDialog = (): void => setState({ newSession: true });
export const closeNewSessionDialog = (): void => setState({ newSession: false });

export const openAttachRepoDialog = (): void => setState({ attachRepo: true });
export const closeAttachRepoDialog = (): void => setState({ attachRepo: false });

/** Test hook: reset between tests. */
export const resetDialogs = (): void => {
  current = { settings: { open: false, section: "general" }, newSession: false, attachRepo: false };
  emit();
};
