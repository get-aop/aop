import { extname, isAbsolute, join, normalize, relative } from "node:path";

/**
 * The app serves two pages of its own over a custom scheme, so neither depends on a server:
 * `app://aop` is the bundled dashboard, and `app://desktop` is the small screen that connects
 * to a host and manages the one on this Mac. They are different origins on purpose. Only the
 * desktop screen may change which host the app talks to, and a host only ever sees a request
 * from `app://aop` (see DESKTOP_APP_ORIGIN in @aop/common).
 */
export const APP_SCHEME = "app";
export const DASHBOARD_HOST = "aop";
export const SHELL_HOST = "desktop";

export type AppSurface = "dashboard" | "shell";

export interface AppRoots {
  dashboardRoot: string;
  shellRoot: string;
}

export interface ResolvedAppFile {
  surface: AppSurface;
  filePath: string;
  /** Served instead when `filePath` is missing: the dashboard's router owns any path without an extension. */
  fallbackPath: string | null;
}

/** Maps a request to the file that answers it, or null for anything outside the two pages. */
export const resolveAppRequest = (rawUrl: string, roots: AppRoots): ResolvedAppFile | null => {
  const url = parseUrl(rawUrl);
  if (url?.protocol !== `${APP_SCHEME}:`) return null;
  const surface = surfaceOf(url.hostname);
  if (!surface) return null;

  const root = surface === "dashboard" ? roots.dashboardRoot : roots.shellRoot;
  const requested = decodePath(url.pathname);
  if (requested === null) return null;
  // The dashboard is a folder inside the desktop screen's own; it must not be reachable as part of it.
  if (surface === "shell" && /^dashboard(\/|$)/.test(requested)) return null;

  const filePath = normalize(join(root, requested === "" ? "index.html" : requested));
  if (!isInside(root, filePath)) return null;

  const spa = surface === "dashboard" && extname(requested) === "";
  return { surface, filePath, fallbackPath: spa ? join(root, "index.html") : null };
};

/**
 * What each page may load. The dashboard may talk to its host, load its images and the avatars
 * of the people on GitHub, Linear and Jira, and frame a PDF it holds in memory, nothing else; the desktop screen talks to the app over IPC and needs no network at all. Scripts come
 * only from the app itself. The live view of the host's screen needs nothing more: it fetches
 * its frames from the host's API (connect-src) and shows them as blob: URLs (img-src).
 */
export const contentSecurityPolicy = (surface: AppSurface, hostOrigin: string | null): string => {
  const host = surface === "dashboard" && hostOrigin ? ` ${hostOrigin}` : "";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data:${surface === "dashboard" ? ` blob:${host} ${AVATAR_ORIGINS}` : ""}`,
    `connect-src 'self'${host}`,
    "object-src 'none'",
    "base-uri 'none'",
    // The artifact view shows a PDF from memory in the built-in viewer; nothing else is framed.
    `frame-src ${surface === "dashboard" ? "blob:" : "'none'"}`,
    "form-action 'none'",
  ].join("; ");
};

// The PR View, the PRs tab and the Issues tab show people's pictures straight from these hosts.
// Only the avatar hosts: any other image (one linked in a pull request's markdown) stays blocked,
// so whoever wrote it cannot tell when, or from where, it was read. Jira Cloud's avatars are on
// Atlassian's avatar host or on Gravatar. Gravatar's default picture redirects through
// i0-i2.wp.com, an open image proxy that would let any image through, so it is left out: a
// person without a Gravatar picture shows their initial. A Jira Data Center site serves its own
// avatars, behind its login, so those fall back to initials too.
const AVATAR_ORIGINS = [
  "https://avatars.githubusercontent.com",
  "https://public.linear.app",
  "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net",
  "https://secure.gravatar.com",
].join(" ");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export interface AppProtocolDeps {
  roots: AppRoots;
  fileExists: (path: string) => boolean;
  /** Reads a file as a response. Electron's `net.fetch` on a file URL in the app. */
  serveFile: (path: string) => Promise<Response>;
  /** The host the dashboard is talking to, for its content security policy. */
  hostOrigin: () => string | null;
}

export const createAppProtocolHandler =
  (deps: AppProtocolDeps) =>
  async (request: Request): Promise<Response> => {
    const resolved = resolveAppRequest(request.url, deps.roots);
    if (!resolved) return notFound();

    const path = existingPath(resolved, deps.fileExists);
    if (!path) return notFound();

    const served = await deps.serveFile(path);
    const headers = new Headers(served.headers);
    const type = CONTENT_TYPES[extname(path).toLowerCase()];
    if (type) headers.set("Content-Type", type);
    headers.set(
      "Content-Security-Policy",
      contentSecurityPolicy(resolved.surface, deps.hostOrigin()),
    );
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(served.body, { status: served.status, headers });
  };

const existingPath = (
  resolved: ResolvedAppFile,
  fileExists: (path: string) => boolean,
): string | null => {
  if (fileExists(resolved.filePath)) return resolved.filePath;
  return resolved.fallbackPath && fileExists(resolved.fallbackPath) ? resolved.fallbackPath : null;
};

const surfaceOf = (hostname: string): AppSurface | null => {
  if (hostname === DASHBOARD_HOST) return "dashboard";
  if (hostname === SHELL_HOST) return "shell";
  return null;
};

const isInside = (root: string, path: string): boolean => {
  const inside = relative(root, path);
  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
};

const decodePath = (pathname: string): string | null => {
  try {
    return decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
};

const notFound = (): Response => new Response("Not found", { status: 404 });

const parseUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};
