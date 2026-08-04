import { beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const {
  dismissMergedPrBar,
  isMergedPrBarDismissed,
  resetMergedPrBarDismissalForTests,
  subscribeMergedPrBarDismissal,
} = await import("./session-merged-pr-dismissal");

beforeEach(() => {
  localStorage.clear();
  resetMergedPrBarDismissalForTests();
});

describe("merged PR bar dismissal store", () => {
  test("nothing is dismissed by default", () => {
    expect(isMergedPrBarDismissed("s1", 42)).toBe(false);
  });

  test("dismiss persists per session and PR number", () => {
    dismissMergedPrBar("s1", 42);
    expect(isMergedPrBarDismissed("s1", 42)).toBe(true);
    expect(isMergedPrBarDismissed("s2", 42)).toBe(false);
  });

  test("a different PR number for the same session is not dismissed", () => {
    dismissMergedPrBar("s1", 42);
    expect(isMergedPrBarDismissed("s1", 43)).toBe(false);
  });

  test("survives a simulated reload via localStorage", () => {
    dismissMergedPrBar("s1", 42);
    resetMergedPrBarDismissalForTests();
    expect(isMergedPrBarDismissed("s1", 42)).toBe(true);
  });

  test("corrupted localStorage reads as not dismissed", () => {
    localStorage.setItem("aop.session-merged-pr-dismissed.s1", "not-a-number");
    resetMergedPrBarDismissalForTests();
    expect(isMergedPrBarDismissed("s1", 42)).toBe(false);
  });

  test("null session or PR is never dismissed", () => {
    dismissMergedPrBar("s1", 42);
    expect(isMergedPrBarDismissed(null, 42)).toBe(false);
    expect(isMergedPrBarDismissed("s1", null)).toBe(false);
  });

  test("notifies subscribers on dismiss", () => {
    let notified = 0;
    const unsubscribe = subscribeMergedPrBarDismissal(() => {
      notified += 1;
    });
    dismissMergedPrBar("s1", 42);
    expect(notified).toBe(1);
    unsubscribe();
    dismissMergedPrBar("s1", 43);
    expect(notified).toBe(1);
  });
});
