import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

import type { TaskPullRequestStatusResponse } from "../api/client";

const defaultPullRequestStatus = (): TaskPullRequestStatusResponse => ({
  success: true,
  branchName: "demo-task",
  hasPullRequest: false,
  pullRequestUrl: null,
  pullRequestNumber: null,
  pullRequestState: null,
  checksState: null,
});

const mockGetTaskPullRequestStatus = mock(async () => defaultPullRequestStatus());
const actualClientModule = await import("../api/client");

mock.module("../api/client", () => ({
  ...actualClientModule,
  getTaskPullRequestStatus: mockGetTaskPullRequestStatus,
}));

const { render, screen, cleanup, act, waitFor } = await import("@testing-library/react");
const { useTaskPullRequestAvailability, clearTaskPullRequestCacheForTests } = await import(
  "./useTaskPullRequestAvailability"
);

const Probe = (props: { task: { id: string; repoId: string; status: "DONE" } }) => {
  const { ready, hasPullRequest, pullRequestState, checksState } = useTaskPullRequestAvailability(
    props.task,
  );
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="has-pr">{String(hasPullRequest)}</span>
      <span data-testid="pr-state">{pullRequestState ?? "none"}</span>
      <span data-testid="checks-state">{checksState ?? "none"}</span>
    </div>
  );
};

const renderProbe = async (task: { id: string; repoId: string; status: "DONE" }) => {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<Probe task={task} />);
    await Promise.resolve();
  });

  if (!result) {
    throw new Error("Probe did not render");
  }

  return result;
};

afterEach(() => {
  cleanup();
  clearTaskPullRequestCacheForTests();
  mockGetTaskPullRequestStatus.mockClear();
});

describe("useTaskPullRequestAvailability", () => {
  beforeEach(() => {
    clearTaskPullRequestCacheForTests();
  });

  test("stays not ready until pull request status resolves", async () => {
    let resolveStatus: (value: Awaited<ReturnType<typeof mockGetTaskPullRequestStatus>>) => void =
      () => undefined;
    mockGetTaskPullRequestStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );

    await renderProbe({ id: "task-1", repoId: "repo-1", status: "DONE" });
    expect(screen.getByTestId("ready").textContent).toBe("false");

    await act(async () => {
      resolveStatus({
        success: true,
        branchName: "demo-task",
        hasPullRequest: true,
        pullRequestUrl: "https://github.com/o/r/pull/1",
        pullRequestNumber: 1,
        pullRequestState: "OPEN",
        checksState: null,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("ready").textContent).toBe("true");
    });
    expect(screen.getByTestId("has-pr").textContent).toBe("true");
  });

  test("uses cache on remount without flipping ready state", async () => {
    mockGetTaskPullRequestStatus.mockResolvedValue({
      success: true,
      branchName: "demo-task",
      hasPullRequest: true,
      pullRequestUrl: "https://github.com/o/r/pull/2",
      pullRequestNumber: 2,
      pullRequestState: "OPEN",
      checksState: null,
    });

    const task = { id: "task-2", repoId: "repo-1", status: "DONE" as const };

    const { unmount } = await renderProbe(task);
    await waitFor(() => {
      expect(screen.getByTestId("ready").textContent).toBe("true");
    });
    unmount();

    await renderProbe(task);
    expect(screen.getByTestId("ready").textContent).toBe("true");
    expect(screen.getByTestId("has-pr").textContent).toBe("true");
  });

  test("exposes merged pull request state", async () => {
    mockGetTaskPullRequestStatus.mockResolvedValue({
      success: true,
      branchName: "demo-task",
      hasPullRequest: true,
      pullRequestUrl: "https://github.com/o/r/pull/3",
      pullRequestNumber: 3,
      pullRequestState: "MERGED",
      checksState: "success",
    });

    await renderProbe({ id: "task-3", repoId: "repo-1", status: "DONE" });

    await waitFor(() => {
      expect(screen.getByTestId("pr-state").textContent).toBe("MERGED");
    });
  });

  test("refreshes pending pull request checks while mounted", async () => {
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;
    const callbacks: Array<() => void> = [];
    window.setInterval = ((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    }) as typeof window.setInterval;
    window.clearInterval = (() => undefined) as typeof window.clearInterval;
    mockGetTaskPullRequestStatus
      .mockResolvedValueOnce({
        success: true,
        branchName: "demo-task",
        hasPullRequest: true,
        pullRequestUrl: "https://github.com/o/r/pull/4",
        pullRequestNumber: 4,
        pullRequestState: "OPEN",
        checksState: null,
      })
      .mockResolvedValueOnce({
        success: true,
        branchName: "demo-task",
        hasPullRequest: true,
        pullRequestUrl: "https://github.com/o/r/pull/4",
        pullRequestNumber: 4,
        pullRequestState: "OPEN",
        checksState: "success",
      });

    try {
      await renderProbe({ id: "task-4", repoId: "repo-1", status: "DONE" });

      await waitFor(() => {
        expect(screen.getByTestId("checks-state").textContent).toBe("none");
      });
      expect(callbacks.length).toBeGreaterThan(0);

      await act(async () => {
        callbacks[0]?.();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId("checks-state").textContent).toBe("success");
      });
    } finally {
      window.setInterval = originalSetInterval;
      window.clearInterval = originalClearInterval;
    }
  });

  test("keeps polling failing checks on an open pull request until a fix lands", async () => {
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;
    const callbacks: Array<() => void> = [];
    window.setInterval = ((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    }) as typeof window.setInterval;
    window.clearInterval = (() => undefined) as typeof window.clearInterval;
    mockGetTaskPullRequestStatus
      .mockResolvedValueOnce({
        success: true,
        branchName: "demo-task",
        hasPullRequest: true,
        pullRequestUrl: "https://github.com/o/r/pull/5",
        pullRequestNumber: 5,
        pullRequestState: "OPEN",
        checksState: "failure",
      })
      .mockResolvedValueOnce({
        success: true,
        branchName: "demo-task",
        hasPullRequest: true,
        pullRequestUrl: "https://github.com/o/r/pull/5",
        pullRequestNumber: 5,
        pullRequestState: "OPEN",
        checksState: "success",
      });

    try {
      await renderProbe({ id: "task-5", repoId: "repo-1", status: "DONE" });

      await waitFor(() => {
        expect(screen.getByTestId("checks-state").textContent).toBe("failure");
      });
      // The bug: polling stopped as soon as checks settled, so a CI fix that
      // turned the second run green never reached the card without a reload.
      expect(callbacks.length).toBeGreaterThan(0);

      await act(async () => {
        callbacks[callbacks.length - 1]?.();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId("checks-state").textContent).toBe("success");
      });
      expect(screen.getByTestId("pr-state").textContent).toBe("OPEN");
    } finally {
      window.setInterval = originalSetInterval;
      window.clearInterval = originalClearInterval;
    }
  });

  test("does not poll a merged pull request", async () => {
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;
    const callbacks: Array<() => void> = [];
    window.setInterval = ((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    }) as typeof window.setInterval;
    window.clearInterval = (() => undefined) as typeof window.clearInterval;
    mockGetTaskPullRequestStatus.mockResolvedValue({
      success: true,
      branchName: "demo-task",
      hasPullRequest: true,
      pullRequestUrl: "https://github.com/o/r/pull/6",
      pullRequestNumber: 6,
      pullRequestState: "MERGED",
      checksState: "success",
    });

    try {
      await renderProbe({ id: "task-6", repoId: "repo-1", status: "DONE" });

      await waitFor(() => {
        expect(screen.getByTestId("pr-state").textContent).toBe("MERGED");
      });
      expect(callbacks.length).toBe(0);
    } finally {
      window.setInterval = originalSetInterval;
      window.clearInterval = originalClearInterval;
    }
  });
});
