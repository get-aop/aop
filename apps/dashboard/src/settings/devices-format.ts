import { formatAge } from "../projects/selectors";

/** "9:41": what is left before a pairing code stops working. Zero once it has. */
export const secondsLeft = (expiresAt: string, now: number): number =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));

export const formatCountdown = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** "Last seen 5m ago", "Last seen Aug 30", or that the device has not connected since it paired. */
export const describeLastSeen = (lastSeenAt: string | null, now: number): string => {
  if (lastSeenAt === null) return "Not seen since it was paired";
  const age = formatAge(lastSeenAt, now);
  if (age === "now") return "Last seen just now";
  return /^\d+[mhd]$/.test(age) ? `Last seen ${age} ago` : `Last seen ${age}`;
};

export const formatPaired = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
