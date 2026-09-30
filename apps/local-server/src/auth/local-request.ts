import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

/**
 * The host owner's own dashboard and CLI need no pairing: a request is the owner's when it
 * is made directly on the host machine. "Directly" is deliberately stricter than "the socket
 * is loopback", because `tailscale serve`, Caddy and every other reverse proxy connect to the
 * server from 127.0.0.1 on behalf of remote clients. A request is direct only when all hold:
 *
 * 1. the TCP peer is a loopback address;
 * 2. the Host header names loopback (`localhost`, `aop.localhost`, `127.0.0.1`, `::1`). A
 *    DNS-rebound page presents its own name, and a proxy forwards the client's name;
 * 3. it carries none of the headers a proxy adds when it forwards a request. This rejects
 *    a proxy that rewrites Host to a loopback name, and holds through the dashboard dev
 *    proxy, which forwards headers it does not own.
 *
 * A proxy that rewrites Host to a loopback name and adds no forwarding header would pass all
 * three. Every proxy AOP documents (tailscale serve, Caddy) avoids that; see docs/HOST.md.
 */
export const isDirectLocalRequest = (c: Context): boolean =>
  isLoopbackAddress(peerAddressOf(c)) && hasLoopbackHost(c) && !hasProxyHeaders(c);

const LOOPBACK_HOSTNAMES = new Set(["localhost", "aop.localhost", "127.0.0.1", "::1", "[::1]"]);

const PROXY_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "via",
  "cf-connecting-ip",
  "true-client-ip",
];
const PROXY_HEADER_PREFIXES = ["tailscale-"];

const peerAddressOf = (c: Context): string | undefined => {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // No socket behind the request (a unit test calling `app.request`): nothing to trust.
    return undefined;
  }
};

const isLoopbackAddress = (address: string | undefined): boolean =>
  address !== undefined &&
  (/^127(\.\d{1,3}){3}$/.test(address) ||
    /^::ffff:127(\.\d{1,3}){3}$/i.test(address) ||
    address === "::1");

// The request URL's authority is derived from the Host header when Bun serves it, so the
// URL is checked as well as the header: both must be loopback.
const hasLoopbackHost = (c: Context): boolean => {
  const hostHeader = c.req.header("host");
  return (
    LOOPBACK_HOSTNAMES.has(new URL(c.req.url).hostname) &&
    (hostHeader === undefined || LOOPBACK_HOSTNAMES.has(hostnameOf(hostHeader)))
  );
};

const hasProxyHeaders = (c: Context): boolean => {
  for (const name of c.req.raw.headers.keys()) {
    if (PROXY_HEADERS.includes(name)) return true;
    if (PROXY_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  }
  return false;
};

const hostnameOf = (host: string): string => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
};
