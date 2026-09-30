import type { Context, MiddlewareHandler } from "hono";

/**
 * Blocks cross-site browser requests to the API (CSRF, and drive-by control of a host that
 * trusts its own loopback). Browsers name the page that made a request in `Origin`; this
 * accepts only the API's own origin and origins the operator listed. Requests with no
 * `Origin` (the CLI, curl, same-origin GETs) pass: what they may do is decided by
 * `createApiAuth`, not here.
 *
 * Any loopback origin used to pass. It no longer does, because a page served from another
 * local port (a dev server, a stray project) would otherwise borrow the owner's access.
 */
export const createOriginGuard = (options: {
  allowedOrigins: readonly string[];
}): MiddlewareHandler => {
  return async (c, next) => {
    if (!isAllowedOrigin(c, options.allowedOrigins)) {
      return c.json({ error: "Forbidden: cross-origin requests are not allowed" }, 403);
    }
    return next();
  };
};

const isAllowedOrigin = (c: Context, allowedOrigins: readonly string[]): boolean => {
  const origin = c.req.header("origin");
  if (origin === undefined) return true;
  // "null" comes from sandboxed iframes and file:// pages, which get no API access.
  if (origin === "null") return false;
  if (allowedOrigins.includes(origin)) return true;
  return hostOfOrigin(origin) === ownHost(c);
};

// Behind a reverse proxy the browser's origin names the public host while Host may have been
// rewritten, so a forwarded host wins. A page cannot forge that header cross-origin: setting
// it makes the browser preflight the request, and the API grants no cross-origin access.
const ownHost = (c: Context): string =>
  (c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host)
    .split(",")[0]
    ?.trim()
    .toLowerCase() ?? "";

const hostOfOrigin = (origin: string): string | null => {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
};
