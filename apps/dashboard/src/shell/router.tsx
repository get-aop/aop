import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * The app's screens. `project` is the project home (its thread grid); the rest are panes of
 * a project that later work fills in: the coordinator chat, a thread, project settings.
 */
export type Route =
  | { name: "projects" }
  | { name: "project"; projectId: string }
  | { name: "coordinator"; projectId: string }
  | { name: "thread"; projectId: string; threadId: string }
  | { name: "project-settings"; projectId: string };

export const projectsPath = (): string => "/";
export const projectPath = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}`;
export const coordinatorPath = (projectId: string): string => `${projectPath(projectId)}/chat`;
export const threadPath = (projectId: string, threadId: string): string =>
  `${projectPath(projectId)}/threads/${encodeURIComponent(threadId)}`;
export const projectSettingsPath = (projectId: string): string =>
  `${projectPath(projectId)}/settings`;

/** The route a path names, or null for a path no screen owns (the app then shows the projects). */
export const parseRoute = (pathname: string): Route | null => {
  const segments = pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segments.length === 0) return { name: "projects" };
  const [root, projectId, pane, threadId] = segments;
  if (root !== "projects" || !projectId) return null;
  if (segments.length === 2) return { name: "project", projectId };
  if (segments.length === 3 && pane === "chat") return { name: "coordinator", projectId };
  if (segments.length === 3 && pane === "settings") return { name: "project-settings", projectId };
  if (segments.length === 4 && pane === "threads" && threadId) {
    return { name: "thread", projectId, threadId };
  }
  return null;
};

export const routeProjectId = (route: Route): string | null =>
  route.name === "projects" ? null : route.projectId;

const NAVIGATE_EVENT = "aop:navigate";

/** Moves to `path` without a page load. Going where you already are adds no history entry. */
export const navigate = (path: string, options: { replace?: boolean } = {}): void => {
  if (window.location.pathname !== path) {
    if (options.replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
  }
  // Even when the address did not change here: whoever changed it may not have told the app.
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
};

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
};

/**
 * The current route. An address no screen owns (an old bookmark) is rewritten to `/`, so the
 * address bar says what is shown; until that happens it reads as the projects screen.
 */
export const useRoute = (): Route => {
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname);
  const route = useMemo(() => parseRoute(pathname), [pathname]);
  useEffect(() => {
    if (route === null) navigate(projectsPath(), { replace: true });
  }, [route]);
  return route ?? { name: "projects" };
};

/** An anchor that navigates without reloading, and still opens in a new tab on modified clicks. */
export const Link = ({
  to,
  onClick,
  ...props
}: Omit<React.ComponentProps<"a">, "href"> & { to: string }) => (
  <a
    href={to}
    onClick={(event) => {
      onClick?.(event);
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (event.defaultPrevented || event.button !== 0 || modified) return;
      event.preventDefault();
      navigate(to);
    }}
    {...props}
  />
);

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};
