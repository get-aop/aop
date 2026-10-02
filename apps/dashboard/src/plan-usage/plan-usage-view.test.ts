import { describe, expect, test } from "bun:test";
import type { PlanUsage } from "@aop/common";
import {
  describeReset,
  formatCountdown,
  formatResetTime,
  levelOf,
  meterLabel,
  peakOf,
  planViews,
  windowView,
} from "./plan-usage-view";

const NOW = Date.parse("2026-10-01T15:00:00.000Z");
const inMs = (ms: number) => new Date(NOW + ms).toISOString();
const HOUR = 3_600_000;

const usage = (fiveHour: number | null, sevenDay: number | null): PlanUsage => ({
  fiveHour:
    fiveHour === null ? null : { usedPercent: fiveHour, resetsAt: inMs(2 * HOUR + 14 * 60_000) },
  sevenDay: sevenDay === null ? null : { usedPercent: sevenDay, resetsAt: inMs(27 * HOUR) },
  updatedAt: inMs(-5 * 60_000),
});

describe("levelOf", () => {
  test.each([
    [0, "calm"],
    [74, "calm"],
    [75, "warm"],
    [89, "warm"],
    [90, "hot"],
    [100, "hot"],
    [null, "calm"],
  ] as const)("%p%% is %s", (percent, level) => {
    expect(levelOf(percent)).toBe(level);
  });
});

describe("windowView", () => {
  test("rounds to a whole percent and keeps the reset", () => {
    const view = windowView("fiveHour", { usedPercent: 42.4, resetsAt: inMs(HOUR) }, NOW);

    expect(view).toEqual({
      key: "fiveHour",
      short: "5h",
      name: "5-hour",
      percent: 42,
      level: "calm",
      resetsAt: NOW + HOUR,
      rolledOver: false,
    });
  });

  test("a window whose reset has passed has rolled over to nothing used", () => {
    const view = windowView("sevenDay", { usedPercent: 97, resetsAt: inMs(-1) }, NOW);

    expect(view).toMatchObject({ percent: 0, level: "calm", resetsAt: null, rolledOver: true });
  });

  test("a window never reported is unknown, not zero", () => {
    expect(windowView("sevenDay", null, NOW)).toMatchObject({
      short: "7d",
      percent: null,
      level: "calm",
      resetsAt: null,
      rolledOver: false,
    });
  });
});

describe("peakOf", () => {
  test("is the fuller window, the 5-hour one on a tie or when the other is unknown", () => {
    expect(peakOf(planViews(usage(20, 86), NOW)).key).toBe("sevenDay");
    expect(peakOf(planViews(usage(91, 40), NOW)).key).toBe("fiveHour");
    expect(peakOf(planViews(usage(50, 50), NOW)).key).toBe("fiveHour");
    expect(peakOf(planViews(usage(3, null), NOW)).key).toBe("fiveHour");
    expect(peakOf(planViews(usage(null, 3), NOW)).key).toBe("sevenDay");
  });
});

describe("formatCountdown", () => {
  test.each([
    [0, "<1m"],
    [-5_000, "<1m"],
    [20_000, "1m"],
    [14 * 60_000, "14m"],
    [59 * 60_000 + 1, "1h"],
    [5 * HOUR, "5h"],
    [2 * HOUR + 14 * 60_000, "2h 14m"],
    [24 * HOUR, "1d"],
    [7 * 24 * HOUR, "7d"],
    [3 * 24 * HOUR + 4 * HOUR + 59 * 60_000, "3d 4h"],
  ])("%p ms reads %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe("describeReset", () => {
  test("counts down, or says why it cannot", () => {
    const [fiveHour] = planViews(usage(42, 10), NOW);

    expect(describeReset(fiveHour, NOW)).toBe("resets in 2h 14m");
    expect(
      describeReset(windowView("fiveHour", { usedPercent: 9, resetsAt: null }, NOW), NOW),
    ).toBe("reset time unknown");
    expect(
      describeReset(windowView("fiveHour", { usedPercent: 9, resetsAt: inMs(-1) }, NOW), NOW),
    ).toBe("reset since the last update");
  });
});

describe("formatResetTime", () => {
  test("names the weekday only for a reset on another day", () => {
    const later = new Date(NOW);
    later.setHours(23, 30, 0, 0);
    const today = new Date(later);
    today.setHours(today.getHours() - 1);
    const now = today.getTime() - 60_000;

    expect(formatResetTime(today.getTime(), now)).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    expect(formatResetTime(today.getTime() + 3 * 24 * HOUR, now)).toMatch(
      /Mon|Tue|Wed|Thu|Fri|Sat|Sun/,
    );
  });
});

describe("meterLabel", () => {
  test("says each window's use and reset for a screen reader", () => {
    expect(meterLabel(planViews(usage(42, 86), NOW), NOW)).toBe(
      "Claude usage: 5-hour usage 42%, resets in 2h 14m; 7-day usage 86%, resets in 1d 3h",
    );
  });

  test("says a window is unknown rather than at zero", () => {
    expect(meterLabel(planViews(usage(42, null), NOW), NOW)).toBe(
      "Claude usage: 5-hour usage 42%, resets in 2h 14m; 7-day usage unknown",
    );
  });
});
