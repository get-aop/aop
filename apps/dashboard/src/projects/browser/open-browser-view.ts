import {
  isProjectScreen,
  navigate,
  type ProjectScreen,
  parseRoute,
  projectScreenPath,
} from "../../shell/router";

/**
 * Shows the AOP Browser where the coordinator chat is, as a new history entry, the way
 * `openPullRequestView` shows a pull request: the threads panel keeps its place and the chat
 * stays mounted underneath with its scroll and its draft. With a `url`, the browser opens it (in
 * the start page in front, or a new tab).
 */
export const openBrowserView = ({ projectId, url }: { projectId: string; url?: string }): void => {
  if (url) queueUrl(projectId, url);
  navigate(projectScreenPath({ ...screenUnder(projectId), browser: true }));
};

/** Gives the chat its place back; the browser keeps its pages, out of sight. */
export const closeBrowserView = (): void => {
  const route = parseRoute(window.location.pathname);
  if (!route || !isProjectScreen(route) || !route.browser) return;
  const { browser: _closed, ...screen } = route;
  navigate(projectScreenPath(screen));
};

/** ⌘⇧B and the top bar's button: the browser if the chat is shown, the chat if the browser is. */
export const toggleBrowserView = (projectId: string): void => {
  const route = parseRoute(window.location.pathname);
  const shown = route !== null && isProjectScreen(route) && route.browser;
  if (shown) closeBrowserView();
  else openBrowserView({ projectId });
};

// The panel keeps its place (a thread, another tab); whatever was in the chat's place (a pull
// request, an artifact) gives way.
const screenUnder = (projectId: string): ProjectScreen => {
  const route = parseRoute(window.location.pathname);
  if (route?.name === "thread" && route.projectId === projectId) {
    return { name: "thread", projectId, threadId: route.threadId };
  }
  if (route?.name === "project-tab" && route.projectId === projectId) {
    return { name: "project-tab", projectId, tab: route.tab };
  }
  return { name: "project", projectId };
};

// Addresses waiting for a project's browser to take them: it may not be mounted yet.
const queued = new Map<string, string[]>();
const listeners = new Set<() => void>();

const queueUrl = (projectId: string, url: string): void => {
  queued.set(projectId, [...(queued.get(projectId) ?? []), url]);
  for (const listener of listeners) listener();
};

/** Hands the browser the addresses queued for it, once each. */
export const takeQueuedUrls = (projectId: string): string[] => {
  const urls = queued.get(projectId) ?? [];
  queued.delete(projectId);
  return urls;
};

export const subscribeQueuedUrls = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
