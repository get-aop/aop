import { useSyncExternalStore } from "react";

export type SettingsSection =
  | "general"
  | "host"
  | "updates"
  | "repositories"
  | "runtimes"
  | "computer-use"
  | "connections"
  | "about";

interface DialogState {
  settings: { open: boolean; section: SettingsSection };
  newProject: boolean;
  attachRepo: boolean;
  /** The project switcher's popover in the top bar (⌘K). */
  switcher: boolean;
}

const CLOSED: DialogState = {
  settings: { open: false, section: "general" },
  newProject: false,
  attachRepo: false,
  switcher: false,
};

let current: DialogState = CLOSED;

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

export const openNewProjectDialog = (): void => setState({ newProject: true });
export const closeNewProjectDialog = (): void => setState({ newProject: false });

// Asked to close on every page move: telling no one when nothing changed keeps that cheap.
export const setProjectSwitcherOpen = (open: boolean): void => {
  if (current.switcher !== open) setState({ switcher: open });
};
export const toggleProjectSwitcher = (): void => setState({ switcher: !current.switcher });

export const openAttachRepoDialog = (): void => setState({ attachRepo: true });
export const closeAttachRepoDialog = (): void => setState({ attachRepo: false });

const attachedListeners = new Set<(repoId: string) => void>();

/** Hears every repository the attach dialog registers, so a list on screen can reload and pick it. */
export const onRepoAttached = (listener: (repoId: string) => void): (() => void) => {
  attachedListeners.add(listener);
  return () => attachedListeners.delete(listener);
};

export const announceRepoAttached = (repoId: string): void => {
  for (const listener of attachedListeners) listener(repoId);
};

/** Test hook: reset between tests. */
export const resetDialogs = (): void => {
  current = CLOSED;
  emit();
};
