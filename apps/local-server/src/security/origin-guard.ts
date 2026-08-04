import type { MiddlewareHandler } from "hono";

// The local server is unauthenticated and trusts the loopback boundary.
// This guard enforces that boundary against browsers: it rejects requests
// whose Host header is not loopback (DNS rebinding) and cross-origin
// requests from non-loopback web origins (drive-by control of the API).
// Requests without an Origin header (CLI, curl, same-origin navigation)
// pass the Host check only.

const LOOPBACK_HOSTNAMES = new Set(["localhost", "aop.localhost", "127.0.0.1", "::1", "[::1]"]);

const hostnameOf = (value: string): string | null => {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`http://${value}`);
    return url.hostname;
  } catch {
    return null;
  }
};

export const isLoopbackHost = (host: string | undefined | null): boolean => {
  if (!host) return false;
  const hostname = hostnameOf(host);
  return hostname !== null && LOOPBACK_HOSTNAMES.has(hostname);
};

export const isAllowedOrigin = (
  origin: string | undefined | null,
  allowedOrigins: readonly string[],
): boolean => {
  if (origin === undefined || origin === null) return true;
  // "null" origins (sandboxed iframes, file://) get no API access.
  if (origin === "null") return false;
  if (allowedOrigins.includes(origin)) return true;
  return isLoopbackHost(origin);
};

export const createOriginGuard = (options: {
  allowedOrigins: readonly string[];
}): MiddlewareHandler => {
  return async (c, next) => {
    // The request URL's authority is derived from the Host header at serve
    // time, so checking the URL hostname covers DNS rebinding; the explicit
    // header is validated too when present.
    const requestHostname = new URL(c.req.url).hostname;
    const hostHeader = c.req.header("host");
    if (!LOOPBACK_HOSTNAMES.has(requestHostname) || (hostHeader && !isLoopbackHost(hostHeader))) {
      return c.json({ error: "Forbidden: non-loopback host" }, 403);
    }
    if (!isAllowedOrigin(c.req.header("origin"), options.allowedOrigins)) {
      return c.json({ error: "Forbidden: cross-origin requests are not allowed" }, 403);
    }
    return next();
  };
};

// Blocks CSRF via subresource requests (<img>, fetch) on endpoints that are
// legitimately reached only by top-level navigation (OAuth/app callbacks).
// Browsers send Sec-Fetch-Dest on every request; non-browser clients omit it.
export const requireNavigationRequest: MiddlewareHandler = async (c, next) => {
  const dest = c.req.header("sec-fetch-dest");
  if (dest && dest !== "document") {
    return c.json({ error: "Forbidden: navigation-only endpoint" }, 403);
  }
  return next();
};
