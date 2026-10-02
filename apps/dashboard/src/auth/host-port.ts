import { buildChannel, type ChannelConfig } from "@aop/common";
import { getHostConfig } from "../api/host";

/**
 * The port the pairing command should reach on the host machine. A page the host serves
 * directly, or a host the desktop app names with a port, already says which one it listens on.
 * A host behind a proxy on the scheme's default port (`tailscale serve` on 443) doesn't, so
 * that falls back to the default of the channel this dashboard was built for.
 */
export const pairingHostPort = (
  channel: ChannelConfig = buildChannel(),
  apiOrigin: string | null = currentApiOrigin(),
): number => {
  const port = apiOrigin ? Number(portOf(apiOrigin)) : 0;
  // The dev dashboard serves its own port and proxies `/api` to the host on the channel's port.
  return port && port !== channel.dashboardPort ? port : channel.hostPort;
};

/** The command that asks the host for a pairing code; it only works on the host machine itself. */
export const pairingCodeCommand = (port: number): string =>
  `curl -s -X POST http://127.0.0.1:${port}/api/auth/pairing-codes`;

const currentApiOrigin = (): string | null =>
  getHostConfig().baseUrl ?? (typeof window === "undefined" ? null : window.location.origin);

const portOf = (origin: string): string => {
  try {
    return new URL(origin).port;
  } catch {
    return "";
  }
};
