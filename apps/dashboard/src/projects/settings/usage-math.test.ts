import { describe, expect, test } from "bun:test";
import { formatCost, formatShare, formatTokens } from "./format";
import { cacheReadShare, rangeOf, totalTokens } from "./usage-math";

const buckets = {
  inputTokens: 10,
  outputTokens: 5,
  cacheWriteTokens: 200,
  cacheReadTokens: 4000,
};

describe("usage math", () => {
  test("totals every bucket", () => {
    expect(totalTokens(buckets)).toBe(4215);
  });

  test("the cache share counts reads against everything the model was given, not its output", () => {
    expect(cacheReadShare(buckets)).toEqual({ part: 4000, whole: 4210 });
  });

  test("a window is the last N hours up to now, or open on both sides", () => {
    const now = Date.parse("2026-09-30T12:00:00.000Z");
    expect(rangeOf("all", now)).toEqual({ since: null, until: null });
    expect(rangeOf("24h", now)).toEqual({ since: "2026-09-29T12:00:00.000Z", until: null });
    expect(rangeOf("7d", now)).toEqual({ since: "2026-09-23T12:00:00.000Z", until: null });
    expect(rangeOf("30d", now)).toEqual({ since: "2026-08-31T12:00:00.000Z", until: null });
  });
});

describe("usage formatting", () => {
  test("token counts are exact below a million and compact above", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(54_000)).toBe("54,000");
    expect(formatTokens(999_999)).toBe("999,999");
    expect(formatTokens(3_400_000)).toBe("3.4M");
    expect(formatTokens(120_000_000)).toBe("120M");
  });

  test("a cost under a cent still reads as a cost", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(0.171525)).toBe("$0.17");
    expect(formatCost(12.5)).toBe("$12.50");
  });

  test("a share rounds to a whole percent, says <1% for a sliver, and is 0% for nothing", () => {
    expect(formatShare(4000, 4210)).toBe("95%");
    expect(formatShare(1, 1000)).toBe("<1%");
    expect(formatShare(0, 1000)).toBe("0%");
    expect(formatShare(5, 0)).toBe("0%");
  });
});
