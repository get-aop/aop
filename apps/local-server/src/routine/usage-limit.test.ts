import { describe, expect, test } from "bun:test";
import { planLimitUntil } from "./usage-limit.ts";

const NOW = new Date("2026-06-01T09:00:00.000Z");
const window = (usedPercent: number, resetsAt: string | null) => ({ usedPercent, resetsAt });

describe("planLimitUntil", () => {
  test("nothing holds runs back while no window is used up", () => {
    expect(planLimitUntil(null, NOW)).toBeNull();
    expect(
      planLimitUntil(
        {
          fiveHour: window(99, "2026-06-01T10:00:00.000Z"),
          sevenDay: null,
          updatedAt: NOW.toISOString(),
        },
        NOW,
      ),
    ).toBeNull();
  });

  test("a used-up window holds runs until its reset; with both, the later reset", () => {
    expect(
      planLimitUntil(
        {
          fiveHour: window(100, "2026-06-01T10:00:00.000Z"),
          sevenDay: window(100, "2026-06-03T00:00:00.000Z"),
          updatedAt: NOW.toISOString(),
        },
        NOW,
      ),
    ).toBe("2026-06-03T00:00:00.000Z");
  });

  test("a window that already reset holds nothing, and one with no reset known waits 15 minutes", () => {
    expect(
      planLimitUntil(
        {
          fiveHour: window(100, "2026-06-01T08:00:00.000Z"),
          sevenDay: null,
          updatedAt: NOW.toISOString(),
        },
        NOW,
      ),
    ).toBeNull();
    expect(
      planLimitUntil(
        { fiveHour: window(100, null), sevenDay: null, updatedAt: NOW.toISOString() },
        NOW,
      ),
    ).toBe("2026-06-01T09:15:00.000Z");
  });
});
