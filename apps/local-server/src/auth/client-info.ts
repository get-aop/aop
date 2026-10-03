import {
  browserPlatformOf,
  type ClientInfo,
  type Device,
  isNewerBuild,
  parseClientHeader,
} from "@aop/common";
import type { HostBuild } from "../update/host-build.ts";

/**
 * The client a request comes from: the desktop app names itself and its version in
 * CLIENT_HEADER; anything else is taken for a browser, whose platform its User-Agent tells.
 */
export const requestClient = (headers: {
  client?: string | null;
  userAgent?: string | null;
}): ClientInfo =>
  parseClientHeader(headers.client) ?? {
    app: "browser",
    version: null,
    platform: browserPlatformOf(headers.userAgent),
  };

export const sameClient = (a: ClientInfo | null | undefined, b: ClientInfo): boolean =>
  a?.app === b.app && a.version === b.version && a.platform === b.platform;

/**
 * The device as clients see it: its client, and whether that is a desktop app older than the
 * host on the same channel. A browser runs the host's own dashboard, so it is never out of date.
 */
export const withClientStatus = (device: Device, host: HostBuild): Device => ({
  ...device,
  client: device.client ?? null,
  outOfDate: isOutOfDate(device.client ?? null, host),
});

const isOutOfDate = (client: ClientInfo | null, host: HostBuild): boolean =>
  client?.app === "desktop" &&
  client.version !== null &&
  isNewerBuild(host.version, client.version, host.channel);
