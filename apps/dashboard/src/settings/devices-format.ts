import type { Device } from "@aop/common";
import { formatAgo } from "../projects/selectors";

/** "9:41": what is left before a pairing code stops working. Zero once it has. */
export const secondsLeft = (expiresAt: string, now: number): number =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));

export const formatCountdown = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** "Last seen 5m ago", "Last seen Aug 30", or that the device has not connected since it paired. */
export const describeLastSeen = (lastSeenAt: string | null, now: number): string => {
  if (lastSeenAt === null) return "Not seen since it was paired";
  return `Last seen ${formatAgo(lastSeenAt, now)}`;
};

export const formatPaired = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
  android: "Android",
  ios: "iOS",
};

/**
 * What the device runs, as AOP settings › Host lists it: "AOP Nightly app 0.10.8 · macOS", or
 * "Browser · uses the host's dashboard, always current". Null until the device has connected
 * since the host learned to ask.
 */
export const describeClient = (device: Device, appName: string): string | null => {
  const { client } = device;
  if (!client) return null;
  const platform = client.platform ? (PLATFORM_NAMES[client.platform] ?? client.platform) : null;
  if (client.app === "browser") {
    return ["Browser", platform, "uses the host's dashboard, always current"]
      .filter(Boolean)
      .join(" · ");
  }
  return [`${appName} app${client.version ? ` ${client.version}` : ""}`, platform]
    .filter(Boolean)
    .join(" · ");
};
