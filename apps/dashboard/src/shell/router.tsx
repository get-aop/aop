import { useEffect, useMemo, useSyncExternalStore } from "react";
import { type AddableTabId, isAddableTabId } from "../projects/layout/panel-tabs";
import { canGoBack, canGoForward, pushEntry, replaceEntry } from "./app-history";

/** The screens of a project's settings, in the order its side nav lists them. */
export const PROJECT_SETTINGS_SECTIONS = [
  "general",
  "models",
  "threads",
  "computer-use",
  "notifications",
  "environment",
  "issues",
  "memory",
  "usage",
  "advanced",
] as const;
export type ProjectSettingsSection = (typeof PROJECT_SETTINGS_SECTIONS)[number];

/** A pull request shown in the coordinator's place: which of the project's repositories, and its number. */
export interface PullRequestViewRef {
  repoId: string;
  number: number;
}

/**
 * What the artifact view shows in the coordinator's place: a Library item (an artifact at one of
 * its versions, or any file), a file a reply linked in its chat's workspace (`threadId` null for
 * the coordinator's), or the diagram Visualize is drawing of a reply.
 */
export type ArtifactViewRef =
  | { kind: "artifact"; id: string; version?: number }
  | { kind: "file"; threadId: string | null; path: string }
  | { kind: "visualize"; messageId: string };

/** What a project screen may show where the chat is, one at a time. */
interface CoordinatorView {
  pullRequest?: PullRequestViewRef;
  artifact?: ArtifactViewRef;
  browser?: true;
  /** An issue of the Issues tab, by its list key (`jira:ABC-12`, `github:owner/name#3`). */
  issue?: string;
}

/**
 * The app's screens. `project` is the project screen: the coordinator chat with the threads
 * panel on its overview. `thread` is the same screen with one thread open in the panel, and
 * `project-tab` the same screen with another of the panel's tabs showing;
 * `project-settings` is one section of the project's settings, in a dialog over the project screen.
 * Any project screen may name a `pullRequest`, an `artifact`, an `issue` or the AOP Browser
 * (`browser`, the desktop app's), one at a time, shown where the chat is while the panel stays.
 */
export type Route =
  | { name: "projects" }
  | ({ name: "project"; projectId: string } & CoordinatorView)
  | ({ name: "thread"; projectId: string; threadId: string } & CoordinatorView)
  | ({ name: "project-tab"; projectId: string; tab: AddableTabId } & CoordinatorView)
  | { name: "project-settings"; projectId: string; section: ProjectSettingsSection };

/** The screens the panel and the chat (or a pull request in its place) share. */
export type ProjectScreen = Extract<Route, { name: "project" | "thread" | "project-tab" }>;

export const projectsPath = (): string => "/";
export const projectPath = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}`;
export const threadPath = (projectId: string, threadId: string): string =>
  `${projectPath(projectId)}/threads/${encodeURIComponent(threadId)}`;
/** The project screen with one of the panel's other tabs (pull requests, ...) showing. */
export const projectTabPath = (projectId: string, tab: AddableTabId): string =>
  `${projectPath(projectId)}/${tab}`;
export const projectSettingsPath = (
  projectId: string,
  section: ProjectSettingsSection = "general",
): string => `${projectPath(projectId)}/settings${section === "general" ? "" : `/${section}`}`;

/** The address of a project screen, with the pull request, artifact or browser it names, if any. */
export const projectScreenPath = (screen: ProjectScreen): string => {
  const base = screenBasePath(screen);
  const pr = screen.pullRequest;
  if (pr) return `${base}/pulls/${encodeURIComponent(pr.repoId)}/${pr.number}`;
  if (screen.artifact) return `${base}${artifactViewPath(screen.artifact)}`;
  if (screen.issue) return `${base}/${ISSUE_SEGMENT}/${encodeURIComponent(screen.issue)}`;
  return screen.browser ? `${base}/${BROWSER_SEGMENT}` : base;
};

/**
 * Where switching to another project goes from `route`: the same tab of the panel, or the same
 * section of the settings, since every project has them. A thread, a pull request, an artifact
 * and the browser belong to the project they are in, so from those it lands on the project's home.
 */
export const switchProjectPath = (route: Route, projectId: string): string => {
  if (route.name === "project-tab") return projectTabPath(projectId, route.tab);
  if (route.name === "project-settings") return projectSettingsPath(projectId, route.section);
  return projectPath(projectId);
};

const artifactViewPath = (ref: ArtifactViewRef): string => {
  switch (ref.kind) {
    case "artifact":
      return `/artifacts/${encodeURIComponent(ref.id)}${ref.version ? `/${ref.version}` : ""}`;
    case "file":
      return `/files/${encodeURIComponent(ref.threadId ?? COORDINATOR_SEGMENT)}/${encodeURIComponent(ref.path)}`;
    case "visualize":
      return `/visualize/${encodeURIComponent(ref.messageId)}`;
  }
};

// A file of the coordinator's workspace names no thread.
const COORDINATOR_SEGMENT = "coordinator";

const screenBasePath = (screen: ProjectScreen): string => {
  if (screen.name === "thread") return threadPath(screen.projectId, screen.threadId);
  if (screen.name === "project-tab") return projectTabPath(screen.projectId, screen.tab);
  return projectPath(screen.projectId);
};

/** The route a path names, or null for a path no screen owns (the app then shows the projects). */
export const parseRoute = (pathname: string): Route | null => {
  const segments = pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segments.length === 0) return { name: "projects" };
  const [root, projectId, ...rest] = segments;
  if (root !== "projects" || !projectId) return null;
  return parseProjectRoute(projectId, rest);
};

// A pull request is the address's last three segments: `pulls/<repoId>/<number>`.
const PULL_REQUEST_SEGMENTS = 3;
// The browser is the address's last segment.
const BROWSER_SEGMENT = "browser";
// An issue is the address's last two segments: `issue/<key>`.
const ISSUE_SEGMENT = "issue";

const parseProjectRoute = (projectId: string, rest: string[]): Route | null => {
  const browser = rest.at(-1) === BROWSER_SEGMENT ? parseBrowserRoute(projectId, rest) : null;
  if (browser) return browser;
  const artifact = parseArtifactSegments(projectId, rest);
  if (artifact !== undefined) return artifact;
  if (rest.at(-2) === ISSUE_SEGMENT) return parseIssueRoute(projectId, rest);
  const pullRequestAt = rest.length - PULL_REQUEST_SEGMENTS;
  if (pullRequestAt >= 0 && rest[pullRequestAt] === "pulls") {
    return parsePullRequestRoute(projectId, rest, pullRequestAt);
  }
  return parseScreenRoute(projectId, rest);
};

const parsePullRequestRoute = (projectId: string, rest: string[], at: number): Route | null => {
  const pullRequest = parsePullRequest(rest.slice(at + 1));
  const before = rest.slice(0, at);
  // The old chat address is only ever bare; it is not a screen a pull request opens over.
  const screen = before[0] === "chat" ? null : parseScreenRoute(projectId, before);
  if (!pullRequest || !screen || !isProjectScreen(screen)) return null;
  return { ...screen, pullRequest };
};

/** Whether the route is a project screen (the chat and the panel), which a pull request can open over. */
export const isProjectScreen = (route: Route): route is ProjectScreen =>
  route.name === "project" || route.name === "thread" || route.name === "project-tab";

const ARTIFACT_VIEWS = new Set(["artifacts", "files", "visualize"]);

// The artifact view follows the screen it opens over: the project's (no segments), a thread's
// (`threads/<id>`) or a tab's (`<tab>`). Undefined when the address names no artifact view.
const parseArtifactSegments = (projectId: string, rest: string[]): Route | null | undefined => {
  const at = rest[0] === "threads" ? 2 : rest[0] && ARTIFACT_VIEWS.has(rest[0]) ? 0 : 1;
  const view = rest[at];
  if (!view || !ARTIFACT_VIEWS.has(view)) return undefined;
  const artifact = parseArtifactView(view, rest.slice(at + 1));
  const screen = parseScreenRoute(projectId, rest.slice(0, at));
  if (!artifact || !screen || !isProjectScreen(screen)) return null;
  return { ...screen, artifact };
};

const parseArtifactView = (view: string, segments: string[]): ArtifactViewRef | null => {
  const [first, second, ...extra] = segments;
  if (!first || extra.length > 0) return null;
  return ARTIFACT_VIEW_PARSERS[view]?.(first, second) ?? null;
};

const ARTIFACT_VIEW_PARSERS: Record<
  string,
  (first: string, second: string | undefined) => ArtifactViewRef | null
> = {
  files: (threadId, path) =>
    path
      ? { kind: "file", threadId: threadId === COORDINATOR_SEGMENT ? null : threadId, path }
      : null,
  visualize: (messageId, extra) => (extra === undefined ? { kind: "visualize", messageId } : null),
  artifacts: (id, version) => parseArtifactVersion(id, version),
};

const parseArtifactVersion = (id: string, version: string | undefined): ArtifactViewRef | null => {
  if (version === undefined) return { kind: "artifact", id };
  return /^[1-9]\d*$/.test(version) ? { kind: "artifact", id, version: Number(version) } : null;
};

const parseIssueRoute = (projectId: string, rest: string[]): Route | null => {
  const issue = rest.at(-1);
  const before = rest.slice(0, -2);
  const screen = before[0] === "chat" ? null : parseScreenRoute(projectId, before);
  return issue && screen && isProjectScreen(screen) ? { ...screen, issue } : null;
};

// Not a browser address after all (a thread whose id is "browser") falls through to the others.
const parseBrowserRoute = (projectId: string, rest: string[]): Route | null => {
  const before = rest.slice(0, -1);
  const screen = before[0] === "chat" ? null : parseScreenRoute(projectId, before);
  return screen && isProjectScreen(screen) ? { ...screen, browser: true } : null;
};

const parsePullRequest = ([repoId, number]: string[]): PullRequestViewRef | null => {
  if (!repoId || !number || !/^[1-9]\d*$/.test(number)) return null;
  const parsed = Number(number);
  return Number.isSafeInteger(parsed) ? { repoId, number: parsed } : null;
};

const parseScreenRoute = (projectId: string, rest: string[]): Route | null => {
  const [pane, detail, ...extra] = rest;
  if (extra.length > 0) return null;
  if (!pane) return { name: "project", projectId };
  // The chat used to have its own address; it is the project screen now (see `useRoute`).
  if (pane === "chat") return detail === undefined ? { name: "project", projectId } : null;
  if (pane === "settings") return parseSettingsRoute(projectId, detail);
  if (pane === "threads" && detail) return { name: "thread", projectId, threadId: detail };
  if (isAddableTabId(pane) && detail === undefined)
    return { name: "project-tab", projectId, tab: pane };
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

const LEGACY_CHAT_PATH = /^\/projects\/[^/]+\/chat\/?$/;

export const routeProjectId = (route: Route): string | null =>
  route.name === "projects" ? null : route.projectId;

const NAVIGATE_EVENT = "aop:navigate";

/** Moves to `path` without a page load. Going where you already are adds no history entry. */
export const navigate = (path: string, options: { replace?: boolean } = {}): void => {
  if (window.location.pathname !== path) {
    if (options.replace) replaceEntry(path);
    else pushEntry(path);
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
 * The current route. An address no screen owns (an old bookmark) is rewritten to `/`, and the
 * old `/projects/:id/chat` to `/projects/:id`, so the address bar says what is shown; until
 * that happens it reads as the screen it will become.
 */
export const useRoute = (): Route => {
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname);
  const route = useMemo(() => parseRoute(pathname), [pathname]);
  useEffect(() => {
    if (route === null) navigate(projectsPath(), { replace: true });
    else if (route.name === "project" && LEGACY_CHAT_PATH.test(pathname)) {
      navigate(projectPath(route.projectId), { replace: true });
    }
  }, [route, pathname]);
  return route ?? { name: "projects" };
};

/** Whether the app's own history has a page behind the current one, and one ahead of it. */
export const useHistoryEnds = (): { back: boolean; forward: boolean } => {
  const ends = useSyncExternalStore(subscribe, () => `${canGoBack()}|${canGoForward()}`);
  return { back: ends.startsWith("true"), forward: ends.endsWith("true") };
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
