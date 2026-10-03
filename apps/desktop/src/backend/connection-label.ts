import { buildChannel } from "@aop/common";
import type { ConnectionState, IncompatibleReason } from "./types";

/** One line saying how the app stands with its host: the window title, the menu, the status screen. */
export const connectionLabel = (connection: ConnectionState): string => {
  switch (connection.status) {
    case "unconfigured":
      return "No host chosen";
    case "connecting":
      return `Connecting to ${hostName(connection.host)}…`;
    case "connected":
      return `Connected to ${hostName(connection.host)}`;
    case "unreachable":
      return `Cannot reach ${hostName(connection.host)}`;
    case "unauthorized":
      return `${hostName(connection.host)} does not accept this device`;
    case "incompatible":
      return `${hostName(connection.host)} needs ${incompatibleFix(connection.reason)}`;
  }
};

/**
 * The window title: the app and its host, "AOP Nightly · soulf". How the connection stands is in
 * the Host menu and on the status screen, and updates are in the Updates popover, so the title
 * stays still.
 */
export const windowTitle = (
  connection: ConnectionState,
  appName: string = buildChannel().productName,
): string =>
  connection.status === "unconfigured" ? appName : `${appName} · ${hostShortName(connection.host)}`;

/**
 * The name a person calls their host: the machine's name, `soulf` for
 * `https://soulf.tailffbdec.ts.net:25650`. An address by number stays as it is, and this
 * computer's own address is "This Mac" (host mode), or "This computer" off macOS.
 */
export const hostShortName = (hostUrl: string): string => {
  let hostname: string;
  try {
    hostname = new URL(hostUrl).hostname;
  } catch {
    return hostUrl;
  }
  if (LOOPBACK.has(hostname)) return onMac() ? "This Mac" : "This computer";
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return hostname;
  return hostname.split(".")[0] || hostname;
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Read in the main process (Node) and in the app's own screens (a browser page) alike.
const onMac = (): boolean =>
  (globalThis as { process?: { platform?: string } }).process?.platform === "darwin" ||
  /Macintosh|Mac OS X/.test(globalThis.navigator?.userAgent ?? "");

/** The host's name and port, without the scheme: what a person recognises their host by. */
export const hostName = (hostUrl: string): string => {
  try {
    return new URL(hostUrl).host;
  } catch {
    return hostUrl;
  }
};

const incompatibleFix = (reason: IncompatibleReason): string => {
  switch (reason) {
    case "client-too-old":
      return "a newer AOP app";
    case "host-too-old":
      return "an update";
    case "not-aop":
      return "an AOP host";
  }
};
