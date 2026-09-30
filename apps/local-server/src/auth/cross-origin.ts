import { cors } from "hono/cors";

/**
 * Lets a page served from another origin read the API's answers. The origin guard has already
 * refused every origin that is neither the API's own nor on the operator's list, so this only
 * has to describe what an allowed page may send: a bearer token, which is how a client that
 * is not served by the host (the desktop app, a dev build) authenticates. The session cookie
 * is `SameSite=Strict`, so a cross-site page never carries it, and `EventSource`, which could
 * only use the cookie, is replaced by a `fetch` reader in such clients.
 */
export const createApiCors = (allowedOrigins: readonly string[]) =>
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Last-Event-ID"],
    // A cross-origin script can read only the headers listed here.
    exposeHeaders: ["Content-Length", "Retry-After"],
    credentials: true,
    // A browser may reuse a preflight answer this long, so a burst of requests sends one.
    maxAge: 600,
  });
