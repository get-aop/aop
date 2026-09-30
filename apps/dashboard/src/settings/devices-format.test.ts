import { describe, expect, test } from "bun:test";
import { describeLastSeen, formatCountdown, secondsLeft } from "./devices-format";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("pairing code countdown", () => {
  test("counts whole seconds up to the expiry and never goes below zero", () => {
    expect(secondsLeft("2026-09-30T12:10:00.000Z", NOW)).toBe(600);
    expect(secondsLeft("2026-09-30T12:00:00.400Z", NOW)).toBe(1);
    expect(secondsLeft("2026-09-30T11:59:00.000Z", NOW)).toBe(0);
  });

  test("reads as minutes and padded seconds", () => {
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(541)).toBe("9:01");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(0)).toBe("0:00");
  });
});

describe("describeLastSeen", () => {
  test("says a device that never connected has not been seen", () => {
    expect(describeLastSeen(null, NOW)).toBe("Not seen since it was paired");
  });

  test("uses a short age for recent activity", () => {
    expect(describeLastSeen(ago(10_000), NOW)).toBe("Last seen just now");
    expect(describeLastSeen(ago(5 * 60_000), NOW)).toBe("Last seen 5m ago");
    expect(describeLastSeen(ago(3 * 3_600_000), NOW)).toBe("Last seen 3h ago");
    expect(describeLastSeen(ago(2 * 86_400_000), NOW)).toBe("Last seen 2d ago");
  });

  test("falls back to a date once the age is a month or more", () => {
    expect(describeLastSeen(ago(45 * 86_400_000), NOW)).toMatch(
      /^Last seen [A-Z][a-z]{2} \d{1,2}$/,
    );
  });
});
