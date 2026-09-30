import { describe, expect, test } from "bun:test";
import {
  formatCost,
  formatShare,
  formatTokens,
  formatWholeCents,
  formatWholePercent,
} from "./format";
import {
  apportion,
  apportionCents,
  apportionPercent,
  cacheReadShare,
  rangeOf,
  totalTokens,
} from "./usage-math";

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

describe("rows that add up", () => {
  test("whole numbers follow the weights and sum to the target exactly", () => {
    expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(apportion([5, 3, 2], 10)).toEqual([5, 3, 2]);
    expect(apportion([0, 0], 100)).toEqual([0, 0]);
    expect(apportion([3, 7], 0)).toEqual([0, 0]);
  });

  test("the percentages of a thread table add up to 100 where rounding each gave 98", () => {
    const tokens = [50_580, 8_430, 8_430, 8_430, 4_215, 4_215, 4_215, 4_215, 4_215, 4_215];
    const whole = tokens.reduce((sum, value) => sum + value, 0);
    const shares = apportionPercent(tokens, whole);

    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(tokens.map((value) => formatShare(value, whole)).join()).not.toBe(shares.join());
  });

  test("parts that do not cover the whole add up to what they cover", () => {
    expect(apportionPercent([25, 25], 100)).toEqual([25, 25]);
    expect(apportionPercent([], 0)).toEqual([]);
  });

  test("costs in cents add up to the rounded sum, and a missing cost stays missing", () => {
    const costs = [0.12, 0.024, 0.024, 0.014, 0.012, 0.012, 0.012, 0.004];
    const cents = apportionCents([...costs, null]);
    const sum = costs.reduce((acc, cost) => acc + cost, 0);

    expect(cents.at(-1)).toBeNull();
    expect(cents.reduce<number>((acc, value) => acc + (value ?? 0), 0)).toBe(Math.round(sum * 100));
    expect(cents[0]).toBe(12);
  });

  test("a sliver never reads as nothing", () => {
    expect(formatWholePercent(0, 3)).toBe("<1%");
    expect(formatWholePercent(0, 0)).toBe("0%");
    expect(formatWholePercent(8, 8430)).toBe("8%");
    expect(formatWholeCents(0, 0.004)).toBe("<$0.01");
    expect(formatWholeCents(0, 0)).toBe("$0.00");
    expect(formatWholeCents(24, 0.2431)).toBe("$0.24");
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
