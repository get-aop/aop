import { describe, expect, test } from "bun:test";
import { formatDuration, formatRelativeAge } from "./format";

describe("formatDuration", () => {
  test("returns milliseconds for sub-second durations", () => {
    const start = "2024-01-01T00:00:00.000Z";
    const end = "2024-01-01T00:00:00.450Z";
    expect(formatDuration(start, end)).toBe("450ms");
  });

  test("returns seconds for durations under 60s", () => {
    const start = "2024-01-01T00:00:00.000Z";
    const end = "2024-01-01T00:00:45.000Z";
    expect(formatDuration(start, end)).toBe("45s");
  });

  test("returns minutes and seconds for durations >= 60s", () => {
    const start = "2024-01-01T00:00:00.000Z";
    const end = "2024-01-01T00:12:34.000Z";
    expect(formatDuration(start, end)).toBe("12m 34s");
  });

  test("clamps negative duration to 0ms", () => {
    const start = "2024-01-01T00:00:01.000Z";
    const end = "2024-01-01T00:00:00.000Z";
    expect(formatDuration(start, end)).toBe("0ms");
  });

  test("shows 1m 0s at exactly 60 seconds", () => {
    const start = "2024-01-01T00:00:00.000Z";
    const end = "2024-01-01T00:01:00.000Z";
    expect(formatDuration(start, end)).toBe("1m 0s");
  });
});

describe("formatRelativeAge", () => {
  const now = new Date("2024-01-03T12:00:00.000Z").getTime();

  test("returns just now for ages under 60 seconds", () => {
    expect(formatRelativeAge("2024-01-03T11:59:30.000Z", now)).toBe("just now");
  });

  test("returns minutes for ages under 60 minutes", () => {
    expect(formatRelativeAge("2024-01-03T11:55:00.000Z", now)).toBe("5m ago");
  });

  test("returns hours for ages under 24 hours", () => {
    expect(formatRelativeAge("2024-01-03T09:00:00.000Z", now)).toBe("3h ago");
  });

  test("returns days for ages 24 hours and older", () => {
    expect(formatRelativeAge("2024-01-01T12:00:00.000Z", now)).toBe("2d ago");
    expect(formatRelativeAge("2023-11-19T12:00:00.000Z", now)).toBe("45d ago");
  });

  test("rounds down at minute, hour, and day boundaries", () => {
    expect(formatRelativeAge("2024-01-03T11:01:00.000Z", now)).toBe("59m ago");
    expect(formatRelativeAge("2024-01-03T11:00:00.000Z", now)).toBe("1h ago");
    expect(formatRelativeAge("2024-01-02T13:00:00.000Z", now)).toBe("23h ago");
    expect(formatRelativeAge("2024-01-02T12:00:00.000Z", now)).toBe("1d ago");
  });

  test("clamps future created dates to just now", () => {
    expect(formatRelativeAge("2024-01-03T12:01:00.000Z", now)).toBe("just now");
  });

  test("returns empty string for invalid dates", () => {
    expect(formatRelativeAge("not-a-date", now)).toBe("");
  });
});
