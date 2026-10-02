import type { RoutineRunStatus, RoutineRunTrigger } from "@aop/common";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long until `iso`, in the largest two units: "in 42s", "in 3h 12m", "in 2d 4h"; "due now" once it has passed. */
export const countdown = (iso: string, now: number): string => {
  const left = Date.parse(iso) - now;
  if (left <= 0) return "due now";
  if (left < MINUTE) return `in ${Math.ceil(left / 1000)}s`;
  if (left < HOUR) return `in ${Math.ceil(left / MINUTE)}m`;
  if (left < DAY) {
    const hours = Math.floor(left / HOUR);
    const minutes = Math.floor((left % HOUR) / MINUTE);
    return minutes === 0 ? `in ${hours}h` : `in ${hours}h ${minutes}m`;
  }
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  return hours === 0 ? `in ${days}d` : `in ${days}d ${hours}h`;
};

/**
 * A run's time on the host's clock: "Mon 1 Jun, 09:00". Built from parts, since how a locale
 * joins date and time ("," or "at") differs between engines.
 */
export const formatRunTime = (iso: string, timeZone: string | null): string => {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    ...(timeZone && { timeZone }),
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))) {
    parts[part.type] = part.value;
  }
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;
};

export const RUN_STATUS_LABEL: Record<RoutineRunStatus, string> = {
  running: "Running",
  ok: "Done",
  failed: "Failed",
  skipped: "Skipped",
  missed: "Missed",
  deferred: "Waiting for usage limit",
};

/** The badge each status wears (ui/badge.tsx status variants). */
export const RUN_STATUS_TONE: Record<
  RoutineRunStatus,
  "done" | "working" | "blocked" | "ready" | "draft"
> = {
  running: "working",
  ok: "done",
  failed: "blocked",
  skipped: "draft",
  missed: "ready",
  deferred: "ready",
};

export const RUN_TRIGGER_LABEL: Record<RoutineRunTrigger, string> = {
  schedule: "Scheduled",
  manual: "Run now",
  "catch-up": "Catch-up",
};
