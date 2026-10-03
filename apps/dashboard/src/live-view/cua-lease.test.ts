import { describe, expect, test } from "bun:test";
import { leaseSummary, threadLeasePlace } from "./cua-lease";
import { makeLease } from "./test-utils";

const login = { threadId: "thr_1", title: "Check the login page" };
const footer = { threadId: "thr_2", title: "Fix the footer" };
const docs = { threadId: "thr_3", title: "Screenshot the docs" };

describe("threadLeasePlace", () => {
  const lease = makeLease(login, [footer, docs]);

  test("says which thread holds the lease and where each waiter stands in line", () => {
    expect(threadLeasePlace(lease, "thr_1")).toEqual({ state: "holding" });
    expect(threadLeasePlace(lease, "thr_2")).toEqual({ state: "waiting", position: 1 });
    expect(threadLeasePlace(lease, "thr_3")).toEqual({ state: "waiting", position: 2 });
  });

  test("is null for a thread that neither holds nor waits, and before the host answered", () => {
    expect(threadLeasePlace(lease, "thr_9")).toBeNull();
    expect(threadLeasePlace(null, "thr_1")).toBeNull();
  });
});

describe("leaseSummary", () => {
  test("names the holder and counts the line", () => {
    expect(leaseSummary(makeLease(login, [footer, docs]))).toBe(
      "Computer use: Check the login page · 2 waiting",
    );
    expect(leaseSummary(makeLease(login))).toBe("Computer use: Check the login page");
  });

  test("calls a lease nobody holds free while threads still wait for it", () => {
    expect(leaseSummary(makeLease(null, [footer]))).toBe("Computer use: free · 1 waiting");
  });

  test("names someone holding the old lock outside AOP's lease", () => {
    const lease = {
      ...makeLease(null),
      holder: { kind: "external" as const, owner: null, since: null },
    };
    expect(leaseSummary(lease)).toBe("Computer use: another program (outside AOP's lease)");
  });

  test("is null when nobody holds or waits for it", () => {
    expect(leaseSummary(makeLease(null))).toBeNull();
    expect(leaseSummary(null)).toBeNull();
  });
});
