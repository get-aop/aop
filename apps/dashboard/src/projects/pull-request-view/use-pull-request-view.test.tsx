import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { json, mockHost } from "../thread/test-utils";
import { makeCheck, makeDetail } from "./test-utils";

setupDashboardDom();

const { act, renderHook } = await import("@testing-library/react");
const { ACTIVE_POLL_MS, IDLE_POLL_MS, pollIntervalOf, usePullRequestView } = await import(
  "./use-pull-request-view"
);

const pending = makeDetail({
  checks: {
    state: "pending",
    total: 1,
    successful: 0,
    failing: 0,
    pending: 1,
    skipped: 0,
    items: [makeCheck({ status: "in_progress" })],
  },
});

describe("pollIntervalOf", () => {
  test("often while checks run or mergeability is computed, rarely when settled, never when done", () => {
    expect(pollIntervalOf(pending)).toBe(ACTIVE_POLL_MS);
    expect(
      pollIntervalOf(
        makeDetail({
          merge: {
            ...makeDetail().merge,
            status: "blocked",
            blockers: [{ kind: "computing", title: "", detail: null }],
          },
        }),
      ),
    ).toBe(ACTIVE_POLL_MS);
    expect(pollIntervalOf(makeDetail())).toBe(IDLE_POLL_MS);
    expect(pollIntervalOf(makeDetail({ state: "merged" }))).toBeNull();
    expect(pollIntervalOf(null)).toBeNull();
  });
});

describe("usePullRequestView polling", () => {
  let host: ReturnType<typeof mockHost>;
  let checksAnswer: () => Response;

  beforeEach(() => {
    jest.useFakeTimers();
    host = mockHost();
    checksAnswer = () =>
      json({
        state: "open",
        headSha: pending.headSha,
        checks: makeDetail().checks,
        merge: makeDetail().merge,
        fetchedAt: "",
      });
    host.respondWith(({ url }) => (url.endsWith("/checks") ? checksAnswer() : json(pending)));
  });
  afterEach(() => {
    jest.useRealTimers();
    host.restore();
  });

  const flush = () =>
    act(async () => {
      for (let index = 0; index < 5; index++) await Promise.resolve();
    });

  test("polls the checks while they run and puts the answer on the page", async () => {
    const { result } = renderHook(() =>
      usePullRequestView({ projectId: "p1", repoId: "repo_1", number: 752 }),
    );
    await flush();
    expect(result.current.detail?.checks.state).toBe("pending");

    await act(async () => {
      jest.advanceTimersByTime(ACTIVE_POLL_MS);
    });
    await flush();
    expect(host.requests.filter((request) => request.url.endsWith("/checks"))).toHaveLength(1);
    expect(result.current.detail?.checks.state).toBe("success");
  });

  test("a new head under the page reads the whole page again", async () => {
    const { result } = renderHook(() =>
      usePullRequestView({ projectId: "p1", repoId: "repo_1", number: 752 }),
    );
    await flush();
    checksAnswer = () =>
      json({
        state: "open",
        headSha: "b".repeat(40),
        checks: pending.checks,
        merge: pending.merge,
        fetchedAt: "",
      });
    await act(async () => {
      jest.advanceTimersByTime(ACTIVE_POLL_MS);
    });
    await flush();
    expect(host.requests.filter((request) => request.url.endsWith("?refresh=1"))).toHaveLength(1);
    expect(result.current.detail).not.toBeNull();
  });

  test("a hidden tab asks nothing", async () => {
    renderHook(() => usePullRequestView({ projectId: "p1", repoId: "repo_1", number: 752 }));
    await flush();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      jest.advanceTimersByTime(ACTIVE_POLL_MS * 3);
    });
    expect(host.requests.filter((request) => request.url.endsWith("/checks"))).toHaveLength(0);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
});
