import type { PlanWindow } from "@aop/common";

/*
 * Claude Code reports the plan's limits in its stream-json output, with no request of its own:
 * a `rate_limit_event` at the start of each turn, and again when a window passes a threshold.
 * Recorded from Claude Code 2.1.x on a Max login (AOP run logs, 2026-10-01):
 *   {"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1790909400,
 *    "rateLimitType":"five_hour","utilization":0.43,...,"unifiedWindows":{
 *    "five_hour":{"utilization":0.43,"resetsAt":1790909400},
 *    "seven_day":{"utilization":0.32,"resetsAt":1791241200}}}}
 * `utilization` is a fraction and `resetsAt` epoch seconds. A refusal (`status: "rejected"`) may
 * describe only its own window, at the top level, and an API-key login writes no such event.
 */

/** What one event says about each window; a window it does not describe is absent. */
export interface PlanReading {
  fiveHour?: PlanWindow;
  sevenDay?: PlanWindow;
}

const MARKER = '"rate_limit_event"';
const WINDOWS = { five_hour: "fiveHour", seven_day: "sevenDay" } as const;
type WindowKey = keyof typeof WINDOWS;
const EPOCH_MS_THRESHOLD = 1e11;

/** The plan windows one line of a run's stream-json output reports, or null when it reports none. */
export const readPlanLimits = (line: string): PlanReading | null => {
  // Most lines are not this event, and a turn writes thousands of them: skip those unparsed.
  if (!line.includes(MARKER)) return null;
  const info = rateLimitInfo(line);
  if (!info) return null;

  const reading: PlanReading = {};
  const unified = record(info.unifiedWindows);
  for (const key of Object.keys(WINDOWS) as WindowKey[]) {
    const window = windowOf(record(unified[key]));
    if (window) reading[WINDOWS[key]] = window;
  }
  applyOwnWindow(reading, info);
  return reading.fiveHour || reading.sevenDay ? reading : null;
};

// The event's own window, from its top level: what an older CLI or a refusal reports. A refused
// window is used up, whatever share it last reported.
const applyOwnWindow = (reading: PlanReading, info: Record<string, unknown>): void => {
  const type = info.rateLimitType;
  if (typeof type !== "string" || !(type in WINDOWS)) return;
  const field = WINDOWS[type as WindowKey];
  const own = reading[field] ?? windowOf(info);
  if (info.status === "rejected") {
    reading[field] = { usedPercent: 100, resetsAt: own?.resetsAt ?? isoOf(info.resetsAt) };
  } else if (own) {
    reading[field] = own;
  }
};

const rateLimitInfo = (line: string): Record<string, unknown> | null => {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  const root = record(event);
  return root.type === "rate_limit_event" ? record(root.rate_limit_info) : null;
};

const windowOf = (source: Record<string, unknown>): PlanWindow | null => {
  const { utilization } = source;
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return null;
  return { usedPercent: percentOf(utilization), resetsAt: isoOf(source.resetsAt) };
};

// A tenth of a percent is finer than the meter shows, and drops the float noise of 0.29 * 100.
const percentOf = (fraction: number): number =>
  Math.min(100, Math.max(0, Math.round(fraction * 1000) / 10));

const isoOf = (value: unknown): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value >= EPOCH_MS_THRESHOLD ? value : value * 1000).toISOString();
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
