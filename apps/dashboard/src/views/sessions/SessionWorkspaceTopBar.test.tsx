import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ChatSessionDetail, SessionGitStatus } from "../../api/client";
import { setupDashboardDom } from "../../test/setup-dom";
import type { SessionPullRequestController } from "./use-session-pull-request";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { SessionWorkspaceTopBar } = await import("./SessionWorkspaceTopBar");

afterEach(cleanup);

const session = {
  id: "isess_1",
  repoName: "aop-mono",
  repoPath: "/repo",
  workspacePath: "/repo/.worktrees/feature",
  title: "Finish Sessions clone",
} as ChatSessionDetail;

const gitStatus = {
  isGitRepo: true,
  dirty: true,
  branch: "feature/sessions",
  isOnDefaultBranch: false,
  aheadOfBase: 0,
  ghAvailable: true,
  pr: null,
} as SessionGitStatus;

const pr = {
  status: null,
  loading: false,
  creating: false,
  merging: false,
  refresh: mock(async () => {}),
  create: mock(async () => ({
    number: 42,
    url: "https://github.com/aop/aop/pull/42",
    state: "OPEN" as const,
    created: true,
  })),
  merge: mock(async () => {
    throw new Error("not used");
  }),
} as SessionPullRequestController;

describe("SessionWorkspaceTopBar", () => {
  test("uses one GitHub split control for commit, push, and PR actions", async () => {
    render(
      <SessionWorkspaceTopBar
        session={session}
        gitStatus={gitStatus}
        pr={pr}
        onToast={mock(() => {})}
        onGitChanged={mock(() => {})}
      />,
    );

    expect(screen.getByTestId("session-source-control-actions")).toBeTruthy();
    expect(screen.queryByText("feature/sessions")).toBeNull();
    expect(screen.getByTestId("session-source-control-icon")).toBeTruthy();
    expect(screen.getByTestId("session-source-control-primary").textContent).toContain(
      "Commit, push & PR",
    );
    expect(screen.queryByTestId("session-create-pr")).toBeNull();

    const gitActionsTrigger = screen.getByRole("button", { name: "Git action options" });
    fireEvent.pointerDown(gitActionsTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(gitActionsTrigger);
    expect(await screen.findByRole("menuitem", { name: "Commit" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Commit & push/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Create PR$/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Draft PR" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy branch" })).toBeTruthy();
  });

  test("keeps an open PR inside the same GitHub split control", async () => {
    render(
      <SessionWorkspaceTopBar
        session={session}
        gitStatus={{
          ...gitStatus,
          dirty: false,
          aheadOfBase: 1,
          pr: {
            number: 42,
            url: "https://github.com/aop/aop/pull/42",
            state: "OPEN",
            title: "Sessions clone",
          },
        }}
        pr={pr}
        onToast={mock(() => {})}
        onGitChanged={mock(() => {})}
      />,
    );

    expect(screen.getByTestId("session-source-control-primary").textContent).toContain("View PR");
    expect(screen.queryByTestId("session-open-pr")).toBeNull();
    const gitActionsTrigger = screen.getByRole("button", { name: "Git action options" });
    fireEvent.pointerDown(gitActionsTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(gitActionsTrigger);
    expect(await screen.findByRole("menuitem", { name: "Open on GitHub" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Create PR$/ })).toBeNull();
  });

  test("does not duplicate worktree creation in the top bar", () => {
    render(
      <SessionWorkspaceTopBar
        session={session}
        gitStatus={gitStatus}
        pr={pr}
        onToast={mock(() => {})}
        onGitChanged={mock(() => {})}
        suggestedWorktreeBranch="feature/sessions"
        onCreateWorktree={mock(async () => {})}
      />,
    );

    expect(screen.queryByTestId("topbar-worktree")).toBeNull();
  });
});
