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
// pairing more devices or revoking them. A stolen laptop therefore cannot mint itself a fresh
// token or lock the owner out of the device list.
const OWNER_ROUTES: readonly RoutePattern[] = [
  ["POST", /^\/api\/auth\/pairing-codes\/?$/],
  ["GET", /^\/api\/auth\/devices\/?$/],
  ["DELETE", /^\/api\/auth\/devices\/[^/]+\/?$/],
  // Replaces the host's own binary and restarts its service.
  ["POST", /^\/api\/updates\/apply\/?$/],
  // Installs a new version of an agent CLI on the host.
  ["POST", /^\/api\/agent-clis\/[^/]+\/update\/?$/],
  // Lets every agent run any command without asking (settings/types.ts OWNER_ONLY_SETTING_KEYS;
  // a bulk write of it is refused in settings/routes.ts, since this table sees paths only).
  ["PUT", /^\/api\/settings\/agent_cli_skip_permissions\/?$/],
  // The caps on routines: how often one may run and how many a project may have on.
  ["PUT", /^\/api\/settings\/routine_(min_interval_minutes|max_active_per_project)\/?$/],
  // Routines start work on the host on their own, unattended: only the owner sets them up.
  ["POST", /^\/api\/projects\/[^/]+\/routines\/?$/],
  ["PATCH", /^\/api\/projects\/[^/]+\/routines\/[^/]+\/?$/],
  ["DELETE", /^\/api\/projects\/[^/]+\/routines\/[^/]+\/?$/],
  ["POST", /^\/api\/projects\/[^/]+\/routines\/[^/]+\/run\/?$/],
  // Invalidates the AOP tool token of every run in flight.
  ["POST", /^\/api\/mcp-secret\/rotate\/?$/],
  // Gives a project's threads control of the host's desktop and browsers.
  ["PUT", /^\/api\/projects\/[^/]+\/computer-use\/?$/],
  // A project's Linear API key: set, mapped, removed or tried only on the host machine, so it
  // never travels from or to a paired device (issues/linear-connection-store.ts).
  ["PUT", /^\/api\/projects\/[^/]+\/linear\/?$/],
  ["DELETE", /^\/api\/projects\/[^/]+\/linear\/?$/],
  ["POST", /^\/api\/projects\/[^/]+\/linear\/catalog\/?$/],
  // A project's Jira token: the same, for the same reason (issues/jira/jira-connection-store.ts).
  // Testing it is the owner's too: it would let a device try tokens against any site from here.
  ["PUT", /^\/api\/projects\/[^/]+\/jira\/?$/],
  ["DELETE", /^\/api\/projects\/[^/]+\/jira\/?$/],
  ["POST", /^\/api\/projects\/[^/]+\/jira\/test\/?$/],
  // Acts on GitHub as the host's `gh` login: comment, review, merge, rename, close, draft.
  [
    "POST",
    /^\/api\/projects\/[^/]+\/github\/repos\/[^/]+\/pulls\/\d+\/(comments|reviews|merge)\/?$/,
  ],
  ["PATCH", /^\/api\/projects\/[^/]+\/github\/repos\/[^/]+\/pulls\/\d+\/?$/],
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
