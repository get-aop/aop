import { AOP_PORTS, AOP_URLS } from "@aop/common";

const DEFAULT_BIND_HOST = "127.0.0.1";

export const getPort = (): number => AOP_PORTS.LOCAL_SERVER;

/**
 * The address the server listens on. Loopback by default: reach the host from other machines
 * through a TLS proxy on the host (`tailscale serve`), which keeps the server off the network.
 * Anything else, such as 0.0.0.0, serves plain HTTP to that network, where every request must
 * still carry a device token.
 */
export const getBindHost = (): string => process.env.AOP_BIND_HOST?.trim() || DEFAULT_BIND_HOST;

export const getDashboardStaticPath = (): string | undefined => process.env.DASHBOARD_STATIC_PATH;

export const getDashboardDevOrigin = (): string | undefined => {
  return process.env.NODE_ENV === "production" ? undefined : AOP_URLS.DASHBOARD;
};

/**
 * Browser origins besides the API's own that may call it, as a comma-separated list. Needed
 * when a reverse proxy rewrites Host and sends no `X-Forwarded-Host`, so the browser's origin
 * (the public name) no longer matches what the server sees.
 */
export const getAllowedOrigins = (): string[] =>
  (process.env.AOP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(toOrigin);

const toOrigin = (entry: string): string => {
  try {
    const url = new URL(entry);
    // A custom scheme such as app:// has no origin for the URL parser, but browsers send one.
    return url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin;
  } catch {
    throw new Error(`AOP_ALLOWED_ORIGINS entry is not a URL: ${entry}`);
  }
};

/**
 * How often, in milliseconds, the watcher looks at an open pull request, for a host that wants a
 * fixed pace instead of the adaptive one (30 seconds while something changes, slower while
 * nothing does). Unset, or not a positive whole number: the adaptive pace.
 */
export const getPullRequestPollIntervalMs = (): number | undefined => {
  const value = Number(process.env.AOP_PR_POLL_INTERVAL_MS);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};
