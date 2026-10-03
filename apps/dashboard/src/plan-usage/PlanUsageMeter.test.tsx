import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakePlanHost, makePlanUsage } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { PlanUsageMeter } = await import("./PlanUsageMeter");
const { resetPlanUsageForTests } = await import("./plan-usage-store");

const originalFetch = globalThis.fetch;

// Local noon, in whatever time zone runs the tests: the 5-hour reset (2h 14m away) stays on
// today's date, so its time shows without a weekday. The wall clock would cross midnight late in
// the evening.
const LOCAL_NOON = new Date(2026, 9, 1, 12, 0, 0);
const WEEKDAY = /Mon|Tue|Wed|Thu|Fri|Sat|Sun/;

beforeEach(() => {
  setSystemTime(LOCAL_NOON);
  resetPlanUsageForTests({ pollMs: 60_000 });
});

afterEach(() => {
  setSystemTime();
  cleanup();
  resetPlanUsageForTests();
  globalThis.fetch = originalFetch;
});

const renderMeter = async () => {
  render(
    <div className="@container">
      <PlanUsageMeter />
    </div>,
  );
  return waitFor(() => screen.getByTestId("plan-usage-meter"));
};

describe("PlanUsageMeter", () => {
  test("shows both windows with their share, labelled for a screen reader", async () => {
    installFakePlanHost({ usage: makePlanUsage(42, 10) });
    const meter = await renderMeter();

    expect(screen.getByTestId("plan-usage-fiveHour").textContent).toBe("5h42%");
    expect(screen.getByTestId("plan-usage-sevenDay").textContent).toBe("7d10%");
    expect(meter.getAttribute("aria-label")).toBe(
      "Claude usage: 5-hour usage 42%, resets in 2h 14m; 7-day usage 10%, resets in 1d 3h",
    );
    expect(meter.tagName).toBe("BUTTON");
  });

  test("turns amber, then red, as a window nears its limit", async () => {
    installFakePlanHost({ usage: makePlanUsage(80, 95) });
    const meter = await renderMeter();

    expect(screen.getByTestId("plan-usage-fiveHour").dataset.level).toBe("warm");
    expect(screen.getByTestId("plan-usage-sevenDay").dataset.level).toBe("hot");
    expect(meter.dataset.level).toBe("hot");
  });

  test("a narrow bar collapses to one ring showing the fuller window", async () => {
    installFakePlanHost({ usage: makePlanUsage(20, 86) });
    await renderMeter();

    // Which of the two shows is the container query's call; both are drawn, each for its width.
    expect(screen.getByTestId("plan-usage-wide").className).toContain("@lg:flex");
    expect(screen.getByTestId("plan-usage-wide").className).toContain("hidden");
    const narrow = screen.getByTestId("plan-usage-narrow");
    expect(narrow.className).toContain("@lg:hidden");
    expect(screen.getByTestId("plan-usage-ring").dataset.window).toBe("sevenDay");
    expect(narrow.textContent).toBe("86%");
  });

  test("focusing it opens the details: use, reset countdown and time, and when it was read", async () => {
    installFakePlanHost({ usage: makePlanUsage(42, 10) });
    const meter = await renderMeter();

    fireEvent.focus(meter);

    const details = await waitFor(() => screen.getByTestId("plan-usage-details"));
    expect(details.textContent).toContain("5-hour window42% used");
    const fiveHour = screen.getByTestId("plan-usage-detail-fiveHour").textContent;
    expect(fiveHour).toMatch(/Resets in 2h 14m · \d{1,2}:14/);
    expect(fiveHour).not.toMatch(WEEKDAY);
    const sevenDay = screen.getByTestId("plan-usage-detail-sevenDay").textContent;
    expect(sevenDay).toContain("Resets in 1d 3h · ");
    expect(sevenDay).toMatch(WEEKDAY);
    expect(screen.getByTestId("plan-usage-updated").textContent).toBe(
      "Updated 3m ago, from the latest Claude Code run.",
    );
  });

  test("a tap opens the details too", async () => {
    installFakePlanHost({ usage: makePlanUsage(42, 10) });
    const meter = await renderMeter();

    fireEvent.click(meter);

    await waitFor(() => expect(screen.getByTestId("plan-usage-details")).toBeTruthy());
  });

  test("a window that has reset since the last run reads as nothing used", async () => {
    const usage = makePlanUsage(97, 30);
    usage.fiveHour = { usedPercent: 97, resetsAt: new Date(Date.now() - 60_000).toISOString() };
    installFakePlanHost({ usage });
    const meter = await renderMeter();

    expect(screen.getByTestId("plan-usage-fiveHour").textContent).toBe("5h0%");
    fireEvent.focus(meter);
    await waitFor(() =>
      expect(screen.getByTestId("plan-usage-detail-fiveHour").textContent).toContain(
        "Reset since the last update",
      ),
    );
  });

  test("an unreported window shows a dash", async () => {
    installFakePlanHost({ usage: makePlanUsage(42, null) });
    await renderMeter();

    expect(screen.getByTestId("plan-usage-sevenDay").textContent).toBe("7d—");
  });

  test("draws nothing until the host has heard the numbers", async () => {
    const host = installFakePlanHost({ usage: null });
    render(<PlanUsageMeter />);

    await waitFor(() => expect(host.calls).toBe(1));
    expect(screen.queryByTestId("plan-usage-meter")).toBeNull();
  });

  test("draws nothing when the host cannot be asked", async () => {
    const host = installFakePlanHost({ usage: new Error("down") });
    render(<PlanUsageMeter />);

    await waitFor(() => expect(host.calls).toBe(1));
    expect(screen.queryByTestId("plan-usage-meter")).toBeNull();
  });
});
