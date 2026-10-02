import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakePlanHost, makePlanUsage } from "./test-utils";

setupDashboardDom();

const { renderHook, waitFor, cleanup } = await import("@testing-library/react");
const { nextPollDelay, resetPlanUsageForTests, usePlanUsage } = await import("./plan-usage-store");

const originalFetch = globalThis.fetch;

beforeEach(() => resetPlanUsageForTests({ pollMs: 10, maxBackoffMs: 40 }));

afterEach(() => {
  cleanup();
  resetPlanUsageForTests();
  globalThis.fetch = originalFetch;
});

describe("nextPollDelay", () => {
  test("is a minute, doubled for every failure in a row, up to ten minutes", () => {
    const polling = { pollMs: 60_000, maxBackoffMs: 600_000 };

    expect(nextPollDelay(0, polling)).toBe(60_000);
    expect(nextPollDelay(1, polling)).toBe(120_000);
    expect(nextPollDelay(3, polling)).toBe(480_000);
    expect(nextPollDelay(9, polling)).toBe(600_000);
  });
});

describe("usePlanUsage", () => {
  test("reads the host's usage and keeps reading it while mounted", async () => {
    const host = installFakePlanHost({ usage: makePlanUsage(42, 10) });
    const { result, unmount } = renderHook(() => usePlanUsage());

    await waitFor(() => expect(result.current.usage?.fiveHour?.usedPercent).toBe(42));
    host.usage = makePlanUsage(57, 11);
    await waitFor(() => expect(result.current.usage?.fiveHour?.usedPercent).toBe(57));

    unmount();
    const calls = host.calls;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.calls).toBe(calls);
  });

  test("two meters share one poller", async () => {
    const host = installFakePlanHost({ usage: makePlanUsage(1, 2) });
    resetPlanUsageForTests({ pollMs: 1_000 });
    renderHook(() => usePlanUsage());
    renderHook(() => usePlanUsage());

    await waitFor(() => expect(host.calls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(host.calls).toBe(1);
  });

  test("a failing host keeps the last numbers and is asked less often", async () => {
    const host = installFakePlanHost({ usage: makePlanUsage(42, 10) });
    const { result } = renderHook(() => usePlanUsage());
    await waitFor(() => expect(result.current.usage).not.toBeNull());

    host.usage = new Error("down");
    const failedFrom = host.calls;
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(result.current.usage?.fiveHour?.usedPercent).toBe(42);
    // At 10, 20, 40, 40 ms apart, 120 ms holds about four tries, not the twelve of a steady poll.
    expect(host.calls - failedFrom).toBeLessThanOrEqual(6);
  });

  test("an API-key login, which reports nothing, stays empty", async () => {
    const host = installFakePlanHost({ usage: null });
    const { result } = renderHook(() => usePlanUsage());

    await waitFor(() => expect(host.calls).toBeGreaterThan(0));
    expect(result.current.usage).toBeNull();
  });
});
