import type { PlanUsage, PlanWindow } from "@aop/common";

/** How close a window is to its limit: calm, then amber, then red. */
export type UsageLevel = "calm" | "warm" | "hot";

/** Claude Code itself starts warning at 75% of a window. */
export const WARM_AT = 75;
export const HOT_AT = 90;

export type WindowKey = "fiveHour" | "sevenDay";

/** One window as the meter draws it, at one moment. */
export interface WindowView {
  key: WindowKey;
  /** "5h" or "7d": the meter's own label. */
  short: string;
  /** "5-hour" or "7-day": what the popover and screen readers say. */
  name: string;
  /** Whole percent used; null when the host has never heard of this window. */
  percent: number | null;
  level: UsageLevel;
  /** When the window resets, in epoch ms; null when unknown or already past. */
  resetsAt: number | null;
  /** The reported reset has passed: the window rolled over, so nothing of it is used yet. */
  rolledOver: boolean;
}

const NAMES: Record<WindowKey, { short: string; name: string }> = {
  fiveHour: { short: "5h", name: "5-hour" },
  sevenDay: { short: "7d", name: "7-day" },
};

export const levelOf = (percent: number | null): UsageLevel => {
  if (percent === null || percent < WARM_AT) return "calm";
  return percent < HOT_AT ? "warm" : "hot";
};

export const windowView = (key: WindowKey, window: PlanWindow | null, now: number): WindowView => {
  const resetsAt = window?.resetsAt ? Date.parse(window.resetsAt) : null;
  const rolledOver = resetsAt !== null && resetsAt <= now;
  const percent = window === null ? null : rolledOver ? 0 : Math.round(window.usedPercent);
  return {
    key,
    ...NAMES[key],
    percent,
    level: levelOf(percent),
    resetsAt: rolledOver ? null : resetsAt,
    rolledOver,
  };
};

/** Both windows, 5-hour first. */
export const planViews = (usage: PlanUsage, now: number): [WindowView, WindowView] => [
  windowView("fiveHour", usage.fiveHour, now),
  windowView("sevenDay", usage.sevenDay, now),
];

/** The window nearer its limit, which a narrow meter shows alone; the 5-hour one on a tie. */
export const peakOf = ([fiveHour, sevenDay]: readonly [WindowView, WindowView]): WindowView =>
  (sevenDay.percent ?? -1) > (fiveHour.percent ?? -1) ? sevenDay : fiveHour;

/** "<1m", "14m", "2h 14m", "5h", "3d 4h": how long until a reset, rounded up to the minute. */
export const formatCountdown = (ms: number): string => {
  const minutes = Math.ceil(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return twoUnits(hours, "h", minutes % 60, "m");
  return twoUnits(Math.floor(hours / 24), "d", hours % 24, "h");
};

const twoUnits = (big: number, bigUnit: string, small: number, smallUnit: string): string =>
  small === 0 ? `${big}${bigUnit}` : `${big}${bigUnit} ${small}${smallUnit}`;

/** "resets in 2h 14m", or why there is no countdown. */
export const describeReset = (view: WindowView, now: number): string => {
  if (view.rolledOver) return "reset since the last update";
  if (view.resetsAt === null) return "reset time unknown";
  return `resets in ${formatCountdown(view.resetsAt - now)}`;
};

/** What the meter says to a screen reader: "5-hour usage 42%, resets in 2h 14m; 7-day …". */
export const meterLabel = (views: readonly WindowView[], now: number): string =>
  `Claude usage: ${views
    .map((view) =>
      view.percent === null
        ? `${view.name} usage unknown`
        : `${view.name} usage ${view.percent}%, ${describeReset(view, now)}`,
    )
    .join("; ")}`;

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayAndClock = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** "5:30 PM" for a reset later today, "Fri 5:00 PM" for one on another day, in local time. */
export const formatResetTime = (at: number, now: number): string =>
  (new Date(at).toDateString() === new Date(now).toDateString() ? clock : dayAndClock).format(at);
