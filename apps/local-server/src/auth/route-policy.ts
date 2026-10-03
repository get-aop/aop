/**
 * Who may call an API route.
 *
 * - `public`: no credentials. Only what a client must reach before it can authenticate, and
 *   what carries its own authentication.
 * - `owner`: the person at the host machine only. Lowers a guard on the host itself.
 * - `manager`: whoever may manage the host under its `host_management` setting: the owner, and
 *   paired devices unless the owner narrowed it to the host machine (auth/host-management.ts).
 *   Updates the host and its agent CLIs, and pairs and revokes devices.
 * - `device`: any authenticated caller, the host owner or a paired device. The default:
 *   a route added later is closed until someone decides otherwise.
 *
 * A request an agent makes through the `aop` CLI during a turn is refused `owner` and `manager`
 * routes whoever it authenticates as (auth/agent-request.ts).
 */
export type RouteAccess = "public" | "owner" | "manager" | "device";

type RoutePattern = readonly [method: string, path: RegExp];

const PUBLIC_ROUTES: readonly RoutePattern[] = [
  ["GET", /^\/api\/health\/?$/],
  // A client without a token trades its pairing code for one here.
  ["POST", /^\/api\/auth\/pair\/?$/],
  // The MCP endpoint checks its own per-session token (docs/adr/mcp-loopback-authentication.md).
  ["*", /^\/api\/mcp(\/.*)?$/],
];

// Looking after the host: keeping it and its agent CLIs current, and who is paired with it. The
// person's everyday setup is an app on another computer, so paired devices may do this unless
// the owner says otherwise; with "owner", a stolen laptop cannot mint itself a fresh token or
// lock the owner out of the device list. Reading the list (`GET /api/auth/devices`) is any
// device's: AOP settings › Host shows it read-only to those who may not manage the host.
const MANAGER_ROUTES: readonly RoutePattern[] = [
  ["POST", /^\/api\/auth\/pairing-codes\/?$/],
  ["DELETE", /^\/api\/auth\/devices\/[^/]+\/?$/],
  // Runs a setup check's fix on the host (host-setup/), such as `aop computer-use setup`.
  ["POST", /^\/api\/host\/setup\/[^/]+\/fix\/?$/],
  // Replaces the host's own binary and restarts its service, now or once turns finish; DELETE
  // cancels an update queued for later.
  ["POST", /^\/api\/updates\/(apply|check)\/?$/],
  ["DELETE", /^\/api\/updates\/apply\/?$/],
  // Installs a new version of an agent CLI on the host.
  ["POST", /^\/api\/agent-clis\/([^/]+\/update|check)\/?$/],
  // When the host updates itself and its agent CLIs (settings/types.ts MANAGER_SETTING_KEYS; a
  // bulk write of them is checked in settings/routes.ts).
  [
    "PUT",
    /^\/api\/settings\/(update_check|update_auto_apply|agent_cli_auto_update|agent_cli_check_interval_minutes)\/?$/,
  ],
];

// A device is trusted with the work (chats, repos, settings) but not with the host's guards.
const OWNER_ROUTES: readonly RoutePattern[] = [
  // Who may manage the host: a device must not widen its own rights.
  ["PUT", /^\/api\/settings\/host_management\/?$/],
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
  if (matches(MANAGER_ROUTES, method, pathname)) return "manager";
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
