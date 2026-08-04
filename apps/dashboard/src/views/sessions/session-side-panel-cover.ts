import { useSyncExternalStore } from "react";

/**
 * True while Sessions shows a right-side panel (diff or markdown). The
 * floating delegation rail shares that corner and must hide until the panel
 * closes so cards do not draw on top of the sidebar.
 */
let covered = false;
const listeners = new Set<() => void>();

export const setSessionSidePanelCovered = (next: boolean): void => {
  if (covered === next) return;
  covered = next;
  for (const listener of listeners) listener();
};

export const isSessionSidePanelCovered = (): boolean => covered;

export const resetSessionSidePanelCovered = (): void => {
  setSessionSidePanelCovered(false);
};

export const useSessionSidePanelCovered = (): boolean =>
  useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    () => covered,
    () => false,
  );
