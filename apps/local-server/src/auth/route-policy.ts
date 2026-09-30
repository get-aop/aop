/**
 * Who may call an API route.
 *
 * - `public`: no credentials. Only what a client must reach before it can authenticate, and
 *   what carries its own authentication.
 * - `owner`: the person at the host machine only. Administers the host itself.
 * - `device`: any authenticated caller, the host owner or a paired device. The default:
 *   a route added later is closed until someone decides otherwise.
 */
export type RouteAccess = "public" | "owner" | "device";

type RoutePattern = readonly [method: string, path: RegExp];

const PUBLIC_ROUTES: readonly RoutePattern[] = [
  ["GET", /^\/api\/health\/?$/],
  // A client without a token trades its pairing code for one here.
  ["POST", /^\/api\/auth\/pair\/?$/],
  // The MCP endpoint checks its own per-session token (docs/adr/mcp-loopback-authentication.md).
  ["*", /^\/api\/mcp(\/.*)?$/],
];

// A device is trusted with the work (chats, repos, settings) but not with the host itself:
// pairing more devices or revoking them, or upgrading the host. A stolen
// laptop therefore cannot mint itself a fresh token or lock the owner out of the device list.
const OWNER_ROUTES: readonly RoutePattern[] = [
  ["POST", /^\/api\/auth\/pairing-codes\/?$/],
  ["GET", /^\/api\/auth\/devices\/?$/],
  ["DELETE", /^\/api\/auth\/devices\/[^/]+\/?$/],
  ["POST", /^\/api\/updates\/install\/?$/],
];

export const routeAccess = (method: string, pathname: string): RouteAccess => {
  if (matches(PUBLIC_ROUTES, method, pathname)) return "public";
  if (matches(OWNER_ROUTES, method, pathname)) return "owner";
  return "device";
};

const matches = (routes: readonly RoutePattern[], method: string, pathname: string): boolean =>
  routes.some(
    ([routeMethod, path]) =>
      (routeMethod === "*" || routeMethod === normalize(method)) && path.test(pathname),
  );

// Hono answers HEAD from the GET handler, so HEAD gets GET's access.
const normalize = (method: string): string => {
  const upper = method.toUpperCase();
  return upper === "HEAD" ? "GET" : upper;
};
