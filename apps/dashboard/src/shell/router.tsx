import { useEffect, useMemo, useSyncExternalStore } from "react";

/** The screens of a project's settings, in the order its side nav lists them. */
export const PROJECT_SETTINGS_SECTIONS = ["general", "memory", "environment", "usage"] as const;
export type ProjectSettingsSection = (typeof PROJECT_SETTINGS_SECTIONS)[number];

/**
 * The app's screens. `project` is the project home (its thread grid); the rest are panes of
 * a project: the coordinator chat, a thread, and one section of the project's settings.
 */
export type Route =
  | { name: "projects" }
  | { name: "project"; projectId: string }
  | { name: "coordinator"; projectId: string }
  | { name: "thread"; projectId: string; threadId: string }
  | { name: "project-settings"; projectId: string; section: ProjectSettingsSection };

export const projectsPath = (): string => "/";
export const projectPath = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}`;
export const coordinatorPath = (projectId: string): string => `${projectPath(projectId)}/chat`;
export const threadPath = (projectId: string, threadId: string): string =>
  `${projectPath(projectId)}/threads/${encodeURIComponent(threadId)}`;
export const projectSettingsPath = (
  projectId: string,
  section: ProjectSettingsSection = "general",
): string => `${projectPath(projectId)}/settings${section === "general" ? "" : `/${section}`}`;

/** The route a path names, or null for a path no screen owns (the app then shows the projects). */
export const parseRoute = (pathname: string): Route | null => {
  const segments = pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segments.length === 0) return { name: "projects" };
  const [root, projectId, ...rest] = segments;
  if (root !== "projects" || !projectId) return null;
  return parseProjectRoute(projectId, rest);
};

const parseProjectRoute = (projectId: string, rest: string[]): Route | null => {
  const [pane, detail, ...extra] = rest;
  if (extra.length > 0) return null;
  if (!pane) return { name: "project", projectId };
  if (pane === "chat") return detail === undefined ? { name: "coordinator", projectId } : null;
  if (pane === "settings") return parseSettingsRoute(projectId, detail);
  if (pane === "threads" && detail) return { name: "thread", projectId, threadId: detail };
  return null;
};

// General is the bare `/settings` address; `/settings/general` is not a second name for it.
const parseSettingsRoute = (projectId: string, detail: string | undefined): Route | null => {
  if (detail === undefined) return { name: "project-settings", projectId, section: "general" };
  const section = PROJECT_SETTINGS_SECTIONS.find(
    (candidate) => candidate === detail && candidate !== "general",
  );
  return section ? { name: "project-settings", projectId, section } : null;
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
