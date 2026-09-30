import { describe, expect, test } from "bun:test";
import { dayMarkerLabel, formatElapsed, formatShortTimestamp } from "./chat-time";

// Local noon on a fixed date, so "today" and "yesterday" mean the same in every time zone.
const now = new Date(2026, 8, 30, 12, 0, 0);
const local = (month: number, day: number, hour = 9): string =>
  new Date(2026, month, day, hour).toISOString();

describe("dayMarkerLabel", () => {
  test("names today and yesterday, and dates anything older", () => {
    expect(dayMarkerLabel(local(8, 30), null, now)).toBe("Today");
    expect(dayMarkerLabel(local(8, 29), null, now)).toBe("Yesterday");
    expect(dayMarkerLabel(local(7, 3), null, now)).toBe("August 3");
    expect(dayMarkerLabel(new Date(2025, 11, 31, 9).toISOString(), null, now)).toBe(
      "December 31, 2025",
    );
  });

  test("marks nothing for a message on the same day as the one before it", () => {
    expect(dayMarkerLabel(local(8, 30, 15), local(8, 30, 9), now)).toBeNull();
    expect(dayMarkerLabel(local(8, 30, 9), local(8, 29, 22), now)).toBe("Today");
  });

  test("marks nothing for a time it cannot read", () => {
    expect(dayMarkerLabel("not a time", null, now)).toBeNull();
  });
});

describe("formatElapsed", () => {
  const since = "2026-09-30T10:00:00.000Z";
  const after = (seconds: number) => Date.parse(since) + seconds * 1000;

  test("counts seconds, then minutes, then hours", () => {
    expect(formatElapsed(since, after(0))).toBe("0s");
    expect(formatElapsed(since, after(42))).toBe("42s");
    expect(formatElapsed(since, after(185))).toBe("3m 05s");
    expect(formatElapsed(since, after(3 * 3600 + 120))).toBe("3h 02m");
  });

  test("never runs backwards, and says nothing for a time it cannot read", () => {
    expect(formatElapsed(since, after(-30))).toBe("0s");
    expect(formatElapsed("nope", after(5))).toBe("");
  });
});

describe("formatShortTimestamp", () => {
  test("is empty for a time it cannot read", () => {
    expect(formatShortTimestamp("nope")).toBe("");
    expect(formatShortTimestamp("2026-09-30T10:00:00.000Z")).not.toBe("");
  });
});
