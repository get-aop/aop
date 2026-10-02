import { useSyncExternalStore } from "react";
import { navigate, parseRoute, projectScreenPath } from "../../shell/router";

/**
 * "Open in Library": shows the Library tab in the panel, with the item selected and previewed,
 * and leaves the artifact view where it is. The tab may not be mounted yet, so the item waits
 * here until the Library panel takes it.
 */
let pending: { projectId: string; itemId: string } | null = null;
const listeners = new Set<() => void>();

export const openInLibrary = (projectId: string, itemId: string): void => {
  pending = { projectId, itemId };
  for (const listener of listeners) listener();
  const route = parseRoute(window.location.pathname);
  const artifact =
    route && route.name !== "projects" && route.name !== "project-settings"
      ? route.artifact
      : undefined;
  navigate(projectScreenPath({ name: "project-tab", projectId, tab: "library", artifact }));
};

/** The item the Library panel should show for this project, if one is waiting. */
export const usePendingLibraryItem = (projectId: string): string | null =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (pending?.projectId === projectId ? pending.itemId : null),
  );

/** The panel took it. */
export const takePendingLibraryItem = (): void => {
  pending = null;
  for (const listener of listeners) listener();
};
