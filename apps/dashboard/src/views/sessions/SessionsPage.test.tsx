import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ChatSessionDetail, ChatSessionMessage, ChatSessionSummary } from "../../api/client";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const session = (id: string): ChatSessionDetail => ({
  id,
  scope: "repository",
  repoId: "repo-1",
  repoName: "aop-mono",
  repoPath: "/tmp/aop-mono",
  workspacePath: "/tmp/aop-mono",
  title: `Session ${id}`,
  named: false,
  runtime: "claude-code",
  model: "claude-opus-4-8",
  reasoningEffort: "medium",
  runtimeAlias: null,
  runtimeSessionId: null,
  fastMode: false,
  pinned: false,
  settledOverride: null,
  settledAt: null,
  lastActivityAt: null,
  hasPendingApproval: false,
  assistantActive: false,
  snippet: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  messages: [],
  skills: [],
});

const createTestSessions = (): ChatSessionDetail[] => [session("one"), session("two")];
let sessions = createTestSessions();
const firstSession = (): ChatSessionDetail => {
  const value = sessions[0];
  if (!value) throw new Error("Expected the first test session");
  return value;
};
const actualClient = await import("../../api/client");
let detailError: Error | null = null;
const getChatSession = mock(async (id: string) => {
  if (detailError) throw detailError;
  return sessions.find((item) => item.id === id) as ChatSessionDetail;
});
const getMarkdownFile = mock(async (path: string) => ({
  path,
  content: "# Plan",
  exists: true,
}));
let locationBranch = "main";
const getChatSessionLocation = mock(async () => ({
  worktreePath: "/tmp/aop-mono",
  branch: locationBranch,
}));
let gitDiffstat = { filesChanged: 0, additions: 0, deletions: 0 };
const getSessionGitStatus = mock(async () => ({
  isGitRepo: true,
  branch: locationBranch,
  defaultBranch: "main",
  isOnDefaultBranch: locationBranch === "main",
  dirty: gitDiffstat.filesChanged > 0,
  diffstat: gitDiffstat,
  aheadOfBase: 0,
  ghAvailable: false,
  pr: null,
  prState: null,
}));
const listSessionGitBranches = mock(async () => ({
  branches: [
    {
      name: locationBranch,
      isCurrent: true,
      isDefault: locationBranch === "main",
      worktreePath: "/tmp/aop-mono",
    },
    {
      name: "feature/branch-picker",
      isCurrent: false,
      isDefault: false,
      worktreePath: null,
    },
  ],
}));
const switchSessionGitBranch = mock(async (_sessionId: string, branch: string) => {
  locationBranch = branch;
  return { branch, workspacePath: "/tmp/aop-mono/.worktrees/branch-picker" };
});
const sampleDiffFile = {
  path: "changed.ts",
  oldPath: null,
  status: "modified" as const,
  additions: 2,
  deletions: 1,
  truncated: false,
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        { type: "context" as const, oldNo: 1, newNo: 1, text: "const x = 1;" },
        { type: "del" as const, oldNo: 2, newNo: null, text: "const y = 2;" },
        { type: "add" as const, oldNo: null, newNo: 2, text: "const y = 3;" },
      ],
    },
  ],
};
const getSessionGitDiff = mock(async () => ({
  defaultBranch: "main",
  perFileLineCap: 2000,
  summaryOnly: true,
  files: [
    {
      ...sampleDiffFile,
      hunks: [],
      detailsPending: true,
    },
  ],
}));
const getSessionGitDiffFile = mock(async () => sampleDiffFile);
let retryError: Error | null = null;
let workspaceResetError: Error | null = null;
let updateSessionError: Error | null = null;
const retryChatRunFresh = mock(async () => {
  if (retryError) throw retryError;
  return { message: {} as ChatSessionMessage, session: firstSession(), existing: false };
});
const setChatSessionWorkspace = mock(async (_sessionId: string, path: string | null) => {
  if (workspaceResetError) throw workspaceResetError;
  detailError = null;
  const active = firstSession();
  active.workspacePath = path ?? active.repoPath;
  return active;
});
const sendChatMessage = mock(async (..._args: Parameters<typeof actualClient.sendChatMessage>) => ({
  message: {
    id: "sent-message",
    sessionId: "one",
    role: "user" as const,
    content: "Follow the configured mode",
    action: null,
    createdAt: new Date().toISOString(),
  },
  session: firstSession(),
}));
let abortResult: Awaited<ReturnType<typeof actualClient.abortChatSession>> = {
  aborted: false,
  disposition: "none",
};
const abortChatSession = mock(async () => abortResult);
const updateChatSession = mock(
  async (id: string, patch: Parameters<typeof actualClient.updateChatSession>[1]) => {
    if (updateSessionError) throw updateSessionError;
    const target = sessions.find((item) => item.id === id);
    if (!target) throw new Error("Session not found");
    if (patch.fastMode !== undefined) target.fastMode = patch.fastMode;
    return target as ChatSessionSummary;
  },
);
const markChatSessionRead = mock(async (id: string) => {
  const target = sessions.find((item) => item.id === id);
  if (!target) throw new Error("Session not found");
  target.unreadCount = 0;
  return target as ChatSessionSummary;
});

mock.module("../../api/client", () => ({
  ...actualClient,
  abortChatSession,
  getAgents: mock(async () => []),
  getChatSession,
  getRuntimeProfiles: mock(async () => []),
  getWorkflowDetails: mock(async () => []),
  getWorkflows: mock(async () => []),
  listChatSessions: mock(async () => sessions as ChatSessionSummary[]),
  getMarkdownFile,
  getChatSessionLocation,
  getSessionGitStatus,
  getSessionGitDiff,
  getSessionGitDiffFile,
  listSessionGitBranches,
  markChatSessionRead,
  retryChatRunFresh,
  sendChatMessage,
  setChatSessionWorkspace,
  switchSessionGitBranch,
  updateChatSession,
}));

type SessionStreamHandler = (event: string, data: unknown) => void;
let sessionStreamHandler: SessionStreamHandler | null = null;
mock.module("../../hooks/useSSE", () => ({
  useSSE: (options: { onMessage?: SessionStreamHandler }) => {
    sessionStreamHandler = options.onMessage ?? null;
    return { connected: true };
  },
}));

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { abortActiveConversation, SessionsPage } = await import("./SessionsPage");
const { getRailProps } = await import("../../shell/rail-store");

/** The rail is shell chrome now: select a thread through the published rail props. */
const selectRailSession = async (sessionId: string) => {
  await waitFor(() => {
    if (!getRailProps()) throw new Error("rail props not published yet");
  });
  act(() => getRailProps()?.onSelect(sessionId));
};
const { sendWithToolInterruptConfirmation } = await import("./sessions-page-model");

beforeEach(() => {
  sessions = createTestSessions();
  sessionStorage.clear();
  sessionStorage.setItem("aop.sessions.activeId", "one");
  locationBranch = "main";
  gitDiffstat = { filesChanged: 0, additions: 0, deletions: 0 };
  getChatSession.mockClear();
  getChatSessionLocation.mockClear();
  getSessionGitStatus.mockClear();
  getSessionGitDiff.mockClear();
  listSessionGitBranches.mockClear();
  switchSessionGitBranch.mockClear();
  updateChatSession.mockClear();
  markChatSessionRead.mockClear();
  abortChatSession.mockClear();
  abortResult = { aborted: false, disposition: "none" };
  sessionStreamHandler = null;
  retryError = null;
  workspaceResetError = null;
  updateSessionError = null;
  detailError = null;
});
afterEach(() => {
  cleanup();
  for (const item of sessions) {
    item.messages = [];
    item.workspacePath = item.repoPath;
    item.assistantActive = false;
    item.assistantLifecycle = "idle";
    item.fastMode = false;
    item.runtime = "claude-code";
    item.model = "claude-opus-4-8";
    item.unreadCount = 0;
  }
  sendChatMessage.mockClear();
  getMarkdownFile.mockClear();
});

describe("SessionsPage composer drafts", () => {
  test("publishes the thread list to the shell rail", async () => {
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await waitFor(() => {
      const titles = (getRailProps()?.groups ?? []).flatMap((group) =>
        group.sessions.map((session) => session.title),
      );
      expect(titles.length).toBeGreaterThan(0);
    });
  });

  test("shows Stop for an uncontrollable recovered lifecycle", async () => {
    firstSession().assistantLifecycle = "uncontrollable";

    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    expect(await screen.findByRole("button", { name: "Stop conversation" })).toBeTruthy();
  });

  test("prefers an explicit idle lifecycle over a stale legacy busy flag", async () => {
    firstSession().assistantActive = true;
    firstSession().assistantLifecycle = "idle";

    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    expect(await screen.findByRole("button", { name: "Send message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop conversation" })).toBeNull();
  });

  test("shows Stop without a queue action when the running composer is empty", async () => {
    firstSession().assistantActive = true;
    firstSession().assistantLifecycle = "running";
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    expect(await screen.findByRole("button", { name: "Stop conversation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Queue message" })).toBeNull();
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  test("counts waiting queued messages in the composer helper", async () => {
    firstSession().assistantActive = true;
    firstSession().assistantLifecycle = "running";
    firstSession().messages = [
      {
        id: "queued-one",
        sessionId: "one",
        role: "user",
        content: "Do this next",
        action: null,
        disposition: "queued",
        createdAt: new Date().toISOString(),
      },
    ];

    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    expect(await screen.findByText("1 queued message will send automatically.")).toBeTruthy();
  });

  test("confirms before retrying a send that would interrupt an active tool", async () => {
    sendChatMessage.mockImplementationOnce(async () => {
      throw Object.assign(new Error("Grok is running a tool. Confirm before interrupting it."), {
        status: 409,
        code: "TOOL_INTERRUPT_CONFIRMATION_REQUIRED",
      });
    });
    const confirm = mock(async () => true);

    await sendWithToolInterruptConfirmation(
      (confirmed) =>
        sendChatMessage("one", "Are you stuck?", [], [], "steer", undefined, [], confirmed),
      confirm,
    );

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sendChatMessage).toHaveBeenCalledTimes(2);
    expect(sendChatMessage.mock.calls[1]?.[7]).toBe(true);
  });

  test("does not call the session-location endpoint", async () => {
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await waitFor(() => expect(getSessionGitStatus).toHaveBeenCalled());
    expect(getChatSessionLocation).not.toHaveBeenCalled();
  });

  test("does not refresh git status on focus while the cache is fresh", async () => {
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await screen.findByTestId("session-workspace-topbar");
    await waitFor(() => expect(screen.getAllByText("main").length).toBeGreaterThan(0));
    await waitFor(() => expect(getSessionGitStatus).toHaveBeenCalledTimes(1));
    locationBranch = "feature/should-not-appear";
    window.dispatchEvent(new window.Event("focus"));
    await act(() => Bun.sleep(50));

    expect(screen.queryByText("feature/should-not-appear")).toBeNull();
    expect(getSessionGitStatus).toHaveBeenCalledTimes(1);
    expect(getChatSessionLocation).not.toHaveBeenCalled();
  });

  test("refreshes git status once when focus arrives after the cache is stale", async () => {
    const realNow = Date.now.bind(Date);
    let now = realNow();
    const nowSpy = spyOn(Date, "now").mockImplementation(() => now);
    try {
      render(
        <SessionsPage
          repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
          onNavigate={() => {}}
        />,
      );

      await screen.findByTestId("session-workspace-topbar");
      await waitFor(() => expect(screen.getAllByText("main").length).toBeGreaterThan(0));
      await waitFor(() => expect(getSessionGitStatus).toHaveBeenCalledTimes(1));
      locationBranch = "feature/refreshed-location";
      now += 16_000;
      window.dispatchEvent(new window.Event("focus"));

      await waitFor(() =>
        expect(screen.getAllByText("feature/refreshed-location").length).toBeGreaterThan(0),
      );
      expect(getSessionGitStatus).toHaveBeenCalledTimes(2);
      expect(getChatSessionLocation).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("does not start a background interval for session location", async () => {
    const setIntervalSpy = spyOn(window, "setInterval");
    try {
      render(
        <SessionsPage
          repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
          onNavigate={() => {}}
        />,
      );

      await screen.findByTestId("session-workspace-topbar");
      await waitFor(() => expect(screen.getAllByText("main").length).toBeGreaterThan(0));
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  test("fetches Git status per session even when workspace paths match", async () => {
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await waitFor(() => expect(getSessionGitStatus).toHaveBeenCalledTimes(1));
    await selectRailSession("two");
    await waitFor(() => expect(getChatSession).toHaveBeenLastCalledWith("two"));
    await waitFor(() => expect(getSessionGitStatus).toHaveBeenCalledTimes(2));
    expect(getSessionGitStatus).toHaveBeenLastCalledWith("two");
  });

  test("fetches git status again when the workspace path differs", async () => {
    const second = sessions[1];
    if (!second) throw new Error("Expected the second test session");
    sessions[1] = { ...second, workspacePath: "/tmp/aop-mono/.worktrees/other" };
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await waitFor(() => expect(getSessionGitStatus).toHaveBeenCalledTimes(1));
    await selectRailSession("two");
    await waitFor(() => expect(getChatSession).toHaveBeenLastCalledWith("two"));
    await waitFor(() => expect(getSessionGitStatus).toHaveBeenCalledTimes(2));
  });

  test("loads session git status and shows the diffstat chip when dirty", async () => {
    locationBranch = "feature/session-diff";
    gitDiffstat = { filesChanged: 2, additions: 5, deletions: 1 };
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    const chip = await screen.findByTestId("session-git-diffstat");
    expect(chip.textContent).toContain("+5");
    expect(chip.textContent).toContain("−1");
    expect(getSessionGitStatus).toHaveBeenCalled();
  });

  test("loads and switches branches from the composer footer", async () => {
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Branch" }));
    const picker = await screen.findByTestId("branch-picker-content");
    fireEvent.click(await within(picker).findByText("feature/branch-picker"));

    await waitFor(() =>
      expect(switchSessionGitBranch).toHaveBeenCalledWith("one", "feature/branch-picker"),
    );
    expect(await screen.findByText("Switched to feature/branch-picker")).toBeTruthy();
  });

  test("hides shared-checkout changes from a fresh session on the default branch", async () => {
    gitDiffstat = { filesChanged: 2, additions: 5, deletions: 5 };
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await waitFor(() => expect(getSessionGitStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("session-git-diffstat")).toBeNull();
  });

  test("toggles and persists fast mode from the lightning button", async () => {
    firstSession().runtime = "codex-cli";
    firstSession().model = "gpt-5.6";
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    const fastMode = await screen.findByTestId("composer-fast-mode");
    fireEvent.click(fastMode);

    await waitFor(() => expect(updateChatSession).toHaveBeenCalledWith("one", { fastMode: true }));
    await waitFor(() =>
      expect(screen.getByTestId("composer-fast-mode").getAttribute("aria-pressed")).toBe("true"),
    );
  });

  test("restores fast mode and reports the error when persistence fails", async () => {
    firstSession().runtime = "codex-cli";
    firstSession().model = "gpt-5.6";
    updateSessionError = new Error("Could not update fast mode");
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    const fastMode = await screen.findByTestId("composer-fast-mode");
    fireEvent.click(fastMode);

    expect(fastMode.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(fastMode.getAttribute("aria-pressed")).toBe("false"));
    await screen.findByText("Could not update fast mode");
  });

  test("diffstat chip opens the right panel at the Diff tab (PLAN §6.3)", async () => {
    locationBranch = "feature/session-diff";
    gitDiffstat = { filesChanged: 1, additions: 2, deletions: 1 };
    firstSession().messages = [
      {
        id: "markdown-message",
        sessionId: "one",
        role: "assistant",
        content: "See `.aop/plans/plan.md`.",
        action: null,
        createdAt: new Date().toISOString(),
      },
    ];
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    fireEvent.click(await screen.findByTestId("session-git-diffstat"));
    await screen.findByTestId("session-diff-panel");
    expect(screen.getByTestId("right-panel")).toBeTruthy();
    expect(getSessionGitDiff).toHaveBeenCalled();

    // Markdown opens in its own side slot alongside the right panel.
    fireEvent.click(await screen.findByRole("button", { name: /plan\.md/i }));
    await screen.findByTestId("session-markdown-panel");
    expect(screen.getByTestId("session-diff-panel")).toBeTruthy();

    // Closing the right panel unmounts the diff pane.
    fireEvent.click(screen.getByTestId("right-panel-close"));
    await waitFor(() => expect(screen.queryByTestId("session-diff-panel")).toBeNull());
  });

  test("forces exactly one git status refresh when a run completes", async () => {
    locationBranch = "feature/session-diff";
    firstSession().assistantActive = true;
    firstSession().assistantLifecycle = "running";
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await screen.findByRole("button", { name: "Stop conversation" });
    // Active runs skip the deferred initial git fetch.
    expect(getSessionGitStatus).not.toHaveBeenCalled();

    gitDiffstat = { filesChanged: 1, additions: 3, deletions: 0 };
    // Return a new object so setDetail triggers a re-render.
    const completed = {
      ...firstSession(),
      assistantActive: false,
      assistantLifecycle: "idle" as const,
    };
    sessions[0] = completed;
    await act(async () => {
      sessionStreamHandler?.("session-updated", { sessionId: "one" });
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop conversation" })).toBeNull(),
    );
    const chip = await screen.findByTestId("session-git-diffstat");
    expect(chip.textContent).toContain("+3");
    expect(getSessionGitStatus).toHaveBeenCalledTimes(1);
  });

  test("does not refresh git status on focus while a run is active", async () => {
    firstSession().assistantActive = true;
    firstSession().assistantLifecycle = "running";
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await screen.findByRole("button", { name: "Stop conversation" });
    window.dispatchEvent(new window.Event("focus"));
    await act(() => Bun.sleep(50));
    expect(getSessionGitStatus).not.toHaveBeenCalled();
  });

  test("selecting a session marks it read and clears its unread state", async () => {
    const second = sessions.find((item) => item.id === "two");
    if (!second) throw new Error("Expected session two");
    second.unreadCount = 4;
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await selectRailSession("two");
    await waitFor(() => expect(markChatSessionRead).toHaveBeenCalledWith("two"));
  });

  test("preserves text and attachments per session across session and page changes", async () => {
    const view = render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    const composer = await screen.findByTestId("chat-composer-input");
    fireEvent.change(composer, { target: { value: "Draft for session one" } });
    fireEvent.change(screen.getByLabelText("Attach documents"), {
      target: {
        files: [new File(["# Browser control"], "browser-control.md", { type: "text/markdown" })],
      },
    });
    await screen.findByText("browser-control.md");

    await selectRailSession("two");
    await waitFor(() =>
      expect((screen.getByTestId("chat-composer-input") as HTMLTextAreaElement).value).toBe(""),
    );
    expect(screen.queryByText("browser-control.md")).toBeNull();
    fireEvent.change(screen.getByTestId("chat-composer-input"), {
      target: { value: "Draft for session two" },
    });

    await selectRailSession("one");
    await waitFor(() =>
      expect((screen.getByTestId("chat-composer-input") as HTMLTextAreaElement).value).toBe(
        "Draft for session one",
      ),
    );
    expect(screen.getByText("browser-control.md")).toBeDefined();

    view.unmount();
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );
    await waitFor(() =>
      expect((screen.getByTestId("chat-composer-input") as HTMLTextAreaElement).value).toBe(
        "Draft for session one",
      ),
    );
    expect(screen.getByText("browser-control.md")).toBeDefined();
  });

  test("opens the markdown panel as a side column beside the chat", async () => {
    const firstSession = sessions.find((item) => item.id === "one");
    if (!firstSession) throw new Error("Expected the first test session");
    const message: ChatSessionMessage = {
      id: "markdown-message",
      sessionId: "one",
      role: "assistant",
      content: "See `.aop/plans/plan.md`.",
      action: null,
      createdAt: new Date().toISOString(),
    };
    firstSession.messages = [message];

    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    const chip = await screen.findByRole("button", { name: /plan\.md/i });
    fireEvent.click(chip);

    await screen.findByText("Plan");
    const panel = screen.getByRole("complementary");
    expect(panel.parentElement?.style.display).toBe("flex");
    expect(panel.parentElement?.style.flexDirection).toBe("");
    expect(getMarkdownFile).toHaveBeenCalledWith("/tmp/aop-mono/.aop/plans/plan.md");
  });

  test("resolves chat file links from the bound workspace", async () => {
    const firstSession = sessions.find((item) => item.id === "one");
    if (!firstSession) throw new Error("Expected the first test session");
    firstSession.workspacePath = "/tmp/aop-mono/.worktrees/continuity";
    firstSession.messages = [
      {
        id: "workspace-markdown-message",
        sessionId: "one",
        role: "assistant",
        content: "See `docs/findings.md`.",
        action: null,
        createdAt: new Date().toISOString(),
      },
    ];

    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /findings\.md/i }));
    await screen.findByRole("complementary");
    expect(getMarkdownFile).toHaveBeenCalledWith(
      "/tmp/aop-mono/.worktrees/continuity/docs/findings.md",
    );
  });

  test("shows rejected retry requests", async () => {
    const activeSession = firstSession();
    activeSession.messages = [
      {
        id: "assistant-timeout",
        sessionId: activeSession.id,
        role: "assistant",
        content: "Startup timed out",
        action: null,
        runId: "crun-timeout",
        runStatus: "failed",
        failureKind: "startup_timeout",
        createdAt: new Date().toISOString(),
      },
    ];
    retryError = new Error("retry failed");
    window.confirm = () => true;

    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Retry in a fresh runtime session" }),
    );
    await screen.findByText("retry failed");
  });

  test("offers recovery when the bound workspace no longer exists", async () => {
    detailError = Object.assign(new Error("Bound chat workspace does not exist"), {
      status: 409,
      code: "WORKSPACE_BINDING_ERROR",
      details: { path: "/tmp/aop-mono/.worktrees/deleted", resettable: true },
    });
    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    await screen.findByTestId("workspace-binding-error");
    expect(screen.getByText("/tmp/aop-mono/.worktrees/deleted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset to repository root" }));
    await screen.findByTestId("chat-composer-input");
    expect(setChatSessionWorkspace).toHaveBeenCalledWith("one", null);
  });

  test("closes the markdown panel when switching sessions", async () => {
    const firstSession = sessions.find((item) => item.id === "one");
    if (!firstSession) throw new Error("Expected the first test session");
    firstSession.messages = [
      {
        id: "markdown-message",
        sessionId: "one",
        role: "assistant",
        content: "See `.aop/plans/plan.md`.",
        action: null,
        createdAt: new Date().toISOString(),
      },
    ];

    render(
      <SessionsPage
        repos={[{ id: "repo-1", name: "aop-mono", path: "/tmp/aop-mono" }]}
        onNavigate={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /plan\.md/i }));
    await screen.findByRole("complementary");
    await selectRailSession("two");

    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  });
});

describe("abortActiveConversation", () => {
  test("reports durable cancellation without claiming the provider stopped", async () => {
    abortResult = { aborted: true, disposition: "durable_cancelled" };
    const showToast = mock(() => {});
    const clearSessionTyping = mock(() => {});
    const clearSessionStreamProgress = mock(() => {});

    await abortActiveConversation({
      sessionId: "one",
      aborting: false,
      assistantStateGenerationRef: { current: 0 },
      setAborting: mock(() => {}),
      clearSessionTyping,
      clearSessionStreamProgress,
      setDetail: mock(() => {}),
      showToast,
      reloadDetailQuiet: mock(async () => ({
        ...session("one"),
        assistantLifecycle: "idle" as const,
      })),
      refreshList: mock(async () => [] as ChatSessionSummary[]),
    });

    expect(showToast).toHaveBeenCalledWith(
      "Stopped tracking the recovered run; its provider process could not be verified",
    );
    expect(showToast).not.toHaveBeenCalledWith("Conversation stopped");
    expect(clearSessionTyping).toHaveBeenCalledWith("one");
    expect(clearSessionStreamProgress).toHaveBeenCalledWith("one");
  });
});
