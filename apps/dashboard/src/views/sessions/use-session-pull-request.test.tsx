import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

import type {
  ChatSessionSummary,
  SessionGitStatus,
  SessionPullRequestStatus,
} from "../../api/client";

const emptyStatus = (): SessionPullRequestStatus => ({
  pr: null,
  checksState: null,
  checks: [],
  merged: null,
});

const openStatus = (
  checksState: "pending" | "success" | "failure",
  mergeable = "MERGEABLE",
): SessionPullRequestStatus => ({
  pr: {
    number: 42,
    url: "https://github.com/o/r/pull/42",
    title: "Demo PR",
    state: "OPEN",
    mergeable,
    baseRefName: "main",
    headRefName: "demo-branch",
  },
  checksState,
  checks: [],
  merged: null,
});

const mergedStatus = (): SessionPullRequestStatus => {
  const fixturePr = openStatus("success").pr;
  if (!fixturePr) throw new Error("expected fixture PR");
  return {
    ...openStatus("success"),
    pr: { ...fixturePr, state: "MERGED" },
    checksState: null,
    merged: {
      number: 42,
      url: "https://github.com/o/r/pull/42",
      title: "Demo PR",
      authorLogin: "octocat",
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      mergedAt: new Date().toISOString(),
      repoNameWithOwner: "o/r",
    },
  };
};

let nextStatus: SessionPullRequestStatus = emptyStatus();
let nextSidebarStates = new Map<string, "open" | "closed" | "merged" | null>();
let failingSidebarSessions = new Set<string>();
const getSessionPullRequestState = mock(async (sessionId: string) => {
  if (failingSidebarSessions.has(sessionId)) throw new Error("temporary failure");
  return { state: nextSidebarStates.get(sessionId) ?? null };
});
const getSessionPullRequestStatus = mock(async () => nextStatus);
const createSessionPullRequest = mock(async () => ({
  number: 42,
  url: "https://github.com/o/r/pull/42",
  state: "OPEN" as const,
  created: true,
}));
const mergeSessionPullRequest = mock(async () => nextStatus);

const actualClient = await import("../../api/client");
mock.module("../../api/client", () => ({
  ...actualClient,
  getSessionPullRequestState,
  getSessionPullRequestStatus,
  createSessionPullRequest,
  mergeSessionPullRequest,
}));

const { render, cleanup, act, waitFor } = await import("@testing-library/react");
const { useSessionPullRequest, useSidebarPullRequestStates } = await import(
  "./use-session-pull-request"
);
const { useState } = await import("react");

const gitStatusWith = (overrides: Partial<SessionGitStatus>): SessionGitStatus => ({
  isGitRepo: true,
  branch: "demo-branch",
  defaultBranch: "main",
  isOnDefaultBranch: false,
  dirty: true,
  diffstat: { filesChanged: 1, additions: 3, deletions: 1 },
  aheadOfBase: 1,
  ghAvailable: true,
  pr: null,
  prState: null,
  ...overrides,
});

const gitStatusWithPr = (): SessionGitStatus =>
  gitStatusWith({
    pr: { number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN", title: "Demo PR" },
    prState: "open",
  });

const Probe = ({
  sessionId,
  gitStatus,
  pollIntervalMs,
  terminalPollIntervalMs,
  onController,
}: {
  sessionId: string | null;
  gitStatus: SessionGitStatus | null;
  pollIntervalMs?: number;
  terminalPollIntervalMs?: number;
  onController: (controller: ReturnType<typeof useSessionPullRequest>) => void;
}) => {
  const controller = useSessionPullRequest(sessionId, gitStatus, {
    pollIntervalMs,
    terminalPollIntervalMs,
  });
  onController(controller);
  return <span data-testid="pr-number">{controller.status?.pr?.number ?? "none"}</span>;
};

beforeEach(() => {
  nextStatus = emptyStatus();
  nextSidebarStates = new Map();
  failingSidebarSessions = new Set();
  getSessionPullRequestState.mockClear();
  getSessionPullRequestStatus.mockClear();
  createSessionPullRequest.mockClear();
  mergeSessionPullRequest.mockClear();
});

afterEach(() => {
  cleanup();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("useSessionPullRequest", () => {
  test("does not fetch while git status reports no PR", async () => {
    render(<Probe sessionId="s1" gitStatus={gitStatusWith({})} onController={() => undefined} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getSessionPullRequestStatus).not.toHaveBeenCalled();
  });

  test("fetches once git status reports a PR for the branch", async () => {
    nextStatus = openStatus("success");
    render(<Probe sessionId="s1" gitStatus={gitStatusWithPr()} onController={() => undefined} />);
    await waitFor(() => expect(getSessionPullRequestStatus).toHaveBeenCalledTimes(1));
  });

  test("does not fetch on the default branch even when git reports a PR", async () => {
    nextStatus = openStatus("success");
    render(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWith({
          branch: "main",
          isOnDefaultBranch: true,
          pr: {
            number: 42,
            url: "https://github.com/o/r/pull/42",
            state: "OPEN",
            title: "Demo PR",
          },
          prState: "open",
        })}
        onController={() => undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(getSessionPullRequestStatus).not.toHaveBeenCalled();
  });

  test("clears a previous PR when the session moves back to the default branch", async () => {
    nextStatus = mergedStatus();
    const handle: { controller: ReturnType<typeof useSessionPullRequest> | null } = {
      controller: null,
    };
    const { rerender } = render(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWithPr()}
        onController={(value) => {
          handle.controller = value;
        }}
      />,
    );
    await waitFor(() => expect(handle.controller?.status?.pr?.state).toBe("MERGED"));

    rerender(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWith({ branch: "main", isOnDefaultBranch: true })}
        onController={(value) => {
          handle.controller = value;
        }}
      />,
    );

    expect(handle.controller?.status).toBeNull();
  });

  test("polls while the PR is open with pending checks and stops on success", async () => {
    nextStatus = openStatus("pending");
    const handle: { controller: ReturnType<typeof useSessionPullRequest> | null } = {
      controller: null,
    };
    render(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWithPr()}
        onController={(value) => {
          handle.controller = value;
        }}
        pollIntervalMs={5}
      />,
    );
    await waitFor(() => expect(getSessionPullRequestStatus.mock.calls.length).toBeGreaterThan(2));

    nextStatus = openStatus("success");
    await waitFor(() => expect(handle.controller?.status?.checksState).toBe("success"));
    const callsBefore = getSessionPullRequestStatus.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(getSessionPullRequestStatus.mock.calls.length).toBe(callsBefore);
  });

  test("keeps polling while mergeable stays UNKNOWN", async () => {
    nextStatus = openStatus("success", "UNKNOWN");
    render(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWithPr()}
        onController={() => undefined}
        pollIntervalMs={5}
      />,
    );
    await waitFor(() => expect(getSessionPullRequestStatus.mock.calls.length).toBeGreaterThan(2));
  });

  test("pauses polling while the document is hidden and resumes when visible", async () => {
    nextStatus = openStatus("pending");
    let visibilityState: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    render(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWithPr()}
        onController={() => undefined}
        pollIntervalMs={5}
      />,
    );
    await waitFor(() => expect(getSessionPullRequestStatus.mock.calls.length).toBeGreaterThan(2));
    visibilityState = "hidden";
    document.dispatchEvent(new window.Event("visibilitychange"));
    const hiddenCalls = getSessionPullRequestStatus.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(getSessionPullRequestStatus.mock.calls.length).toBe(hiddenCalls);

    visibilityState = "visible";
    document.dispatchEvent(new window.Event("visibilitychange"));
    await waitFor(() =>
      expect(getSessionPullRequestStatus.mock.calls.length).toBeGreaterThan(hiddenCalls),
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  test("detects an external merge after checks have passed", async () => {
    nextStatus = openStatus("success");
    const handle: { controller: ReturnType<typeof useSessionPullRequest> | null } = {
      controller: null,
    };
    render(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWithPr()}
        onController={(value) => {
          handle.controller = value;
        }}
        terminalPollIntervalMs={5}
      />,
    );
    await waitFor(() => expect(handle.controller?.status?.checksState).toBe("success"));
    nextStatus = mergedStatus();
    await waitFor(() => expect(handle.controller?.status?.pr?.state).toBe("MERGED"));
  });

  test("create marks the PR as tracked and fetches the status exactly once", async () => {
    nextStatus = openStatus("pending");
    const handle: { controller: ReturnType<typeof useSessionPullRequest> | null } = {
      controller: null,
    };
    render(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWith({})}
        onController={(value) => {
          handle.controller = value;
        }}
      />,
    );
    expect(getSessionPullRequestStatus).not.toHaveBeenCalled();

    await act(async () => {
      await handle.controller?.create("create");
    });
    expect(createSessionPullRequest).toHaveBeenCalledWith("s1", "create");
    await waitFor(() => expect(handle.controller?.status?.pr?.number).toBe(42));
    // Exactly one fetch: the tracked-flip effect, no double fetch from create().
    expect(getSessionPullRequestStatus).toHaveBeenCalledTimes(1);
  });

  test("merge posts the method and adopts the returned status", async () => {
    const fixturePr = openStatus("success").pr;
    if (!fixturePr) throw new Error("expected fixture PR");
    nextStatus = {
      ...openStatus("success"),
      pr: { ...fixturePr, state: "MERGED" },
      checksState: null,
      merged: {
        number: 42,
        url: "https://github.com/o/r/pull/42",
        title: "Demo PR",
        authorLogin: "octocat",
        additions: 10,
        deletions: 2,
        changedFiles: 3,
        mergedAt: new Date().toISOString(),
        repoNameWithOwner: "o/r",
      },
    };
    const handle: { controller: ReturnType<typeof useSessionPullRequest> | null } = {
      controller: null,
    };
    render(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWithPr()}
        onController={(value) => {
          handle.controller = value;
        }}
      />,
    );
    await waitFor(() => expect(getSessionPullRequestStatus).toHaveBeenCalled());

    await act(async () => {
      await handle.controller?.merge("squash");
    });
    expect(mergeSessionPullRequest).toHaveBeenCalledWith("s1", "squash");
    expect(handle.controller?.status?.pr?.state).toBe("MERGED");
    expect(handle.controller?.status?.merged?.authorLogin).toBe("octocat");
  });

  test("refetches when git status observes a PR state flip (external merge)", async () => {
    nextStatus = openStatus("success");
    const handle: { controller: ReturnType<typeof useSessionPullRequest> | null } = {
      controller: null,
    };
    const { rerender } = render(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWithPr()}
        onController={(value) => {
          handle.controller = value;
        }}
      />,
    );
    await waitFor(() => expect(getSessionPullRequestStatus).toHaveBeenCalledTimes(1));

    // A git-status refresh (run finished / window focus) now sees the PR merged.
    const fixturePr = openStatus("success").pr;
    if (!fixturePr) throw new Error("expected fixture PR");
    nextStatus = {
      ...openStatus("success"),
      pr: { ...fixturePr, state: "MERGED" },
      checksState: null,
      merged: {
        number: 42,
        url: "https://github.com/o/r/pull/42",
        title: "Demo PR",
        authorLogin: "octocat",
        additions: 10,
        deletions: 2,
        changedFiles: 3,
        mergedAt: new Date().toISOString(),
        repoNameWithOwner: "o/r",
      },
    };
    rerender(
      <Probe
        sessionId="s1"
        gitStatus={gitStatusWith({
          pr: {
            number: 42,
            url: "https://github.com/o/r/pull/42",
            state: "MERGED",
            title: "Demo PR",
          },
          prState: "merged",
        })}
        onController={(value) => {
          handle.controller = value;
        }}
      />,
    );
    await waitFor(() => expect(handle.controller?.status?.pr?.state).toBe("MERGED"));
    expect(handle.controller?.status?.merged?.number).toBe(42);
  });

  test("switching sessions clears the previous status", async () => {
    nextStatus = openStatus("success");
    const handle: { controller: ReturnType<typeof useSessionPullRequest> | null } = {
      controller: null,
    };
    const Swap = () => {
      const [sessionId, setSessionId] = useState("s1");
      return (
        <>
          <button type="button" data-testid="swap" onClick={() => setSessionId("s2")} />
          <Probe
            sessionId={sessionId}
            gitStatus={gitStatusWithPr()}
            onController={(value) => {
              handle.controller = value;
            }}
          />
        </>
      );
    };
    const { getByTestId } = render(<Swap />);
    await waitFor(() => expect(handle.controller?.status?.pr?.number).toBe(42));

    // The new session has no PR; the old session's status must not linger.
    nextStatus = emptyStatus();
    await act(async () => {
      getByTestId("swap").click();
      await Promise.resolve();
    });
    await waitFor(() => expect(handle.controller?.status?.pr).toBeNull());
    expect(handle.controller?.status?.pr).toBeNull();
  });
});

const sidebarSummary = (id: string, repoId: string | null): ChatSessionSummary =>
  ({ id, repoId }) as ChatSessionSummary;

const SidebarProbe = ({
  sessions,
  activeSessionId,
  activePrState,
  pollIntervalMs,
}: {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  activePrState: "open" | "closed" | "merged" | null;
  pollIntervalMs?: number;
}) => {
  const states = useSidebarPullRequestStates(
    sessions,
    activeSessionId,
    activePrState,
    pollIntervalMs,
  );
  return <span data-testid="sidebar-states">{JSON.stringify(Object.fromEntries(states))}</span>;
};

describe("useSidebarPullRequestStates", () => {
  test("polls repository sessions except the active one and merges its live state", async () => {
    nextSidebarStates.set("s2", "closed");
    const { getByTestId } = render(
      <SidebarProbe
        sessions={[
          sidebarSummary("s1", "repo"),
          sidebarSummary("s2", "repo"),
          sidebarSummary("task", null),
        ]}
        activeSessionId="s1"
        activePrState="merged"
      />,
    );

    await waitFor(() =>
      expect(JSON.parse(getByTestId("sidebar-states").textContent ?? "{}")).toEqual({
        s1: "merged",
        s2: "closed",
      }),
    );
    expect(getSessionPullRequestState.mock.calls).toEqual([["s2"]]);
  });

  test("preserves a known state through transient polling failures", async () => {
    nextSidebarStates.set("s2", "closed");
    const { getByTestId } = render(
      <SidebarProbe
        sessions={[sidebarSummary("s2", "repo")]}
        activeSessionId={null}
        activePrState={null}
        pollIntervalMs={5}
      />,
    );
    await waitFor(() =>
      expect(JSON.parse(getByTestId("sidebar-states").textContent ?? "{}")).toEqual({
        s2: "closed",
      }),
    );

    failingSidebarSessions.add("s2");
    const callsBeforeFailure = getSessionPullRequestState.mock.calls.length;
    await waitFor(() =>
      expect(getSessionPullRequestState.mock.calls.length).toBeGreaterThan(callsBeforeFailure),
    );
    expect(JSON.parse(getByTestId("sidebar-states").textContent ?? "{}")).toEqual({
      s2: "closed",
    });
  });
});
