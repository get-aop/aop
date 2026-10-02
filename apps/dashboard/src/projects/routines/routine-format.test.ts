import { describe, expect, test } from "bun:test";
import { countdown, formatRunTime } from "./routine-format";

const NOW = Date.parse("2026-06-01T09:00:00.000Z");
const later = (ms: number) => new Date(NOW + ms).toISOString();

describe("countdown", () => {
  test.each([
    [-5_000, "due now"],
    [0, "due now"],
    [42_000, "in 42s"],
    [5 * 60_000, "in 5m"],
    [3 * 3_600_000, "in 3h"],
    [3 * 3_600_000 + 12 * 60_000, "in 3h 12m"],
    [2 * 86_400_000, "in 2d"],
    [2 * 86_400_000 + 4 * 3_600_000, "in 2d 4h"],
  ])("%p ms ahead reads %p", (ms, words) => {
    expect(countdown(later(ms), NOW)).toBe(words);
  });
});

test("a run's time is read on the host's clock", () => {
  expect(formatRunTime("2026-06-01T13:00:00.000Z", "America/New_York")).toBe("Mon 1 Jun, 09:00");
  expect(formatRunTime("2026-06-01T13:00:00.000Z", "UTC")).toBe("Mon 1 Jun, 13:00");
});
