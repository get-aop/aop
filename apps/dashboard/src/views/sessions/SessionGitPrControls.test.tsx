import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

import type { SessionGitStatus, SessionPullRequestStatus } from "../../api/client";

const { render, screen, cleanup, fireEvent, act, waitFor } = await import("@testing-library/react");
const { SessionGitPrControls } = await import("./SessionGitPrControls");

const gitStatusWith = (overrides: Partial<SessionGitStatus> = {}): SessionGitStatus => ({
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

const openPrStatus = (
  checksState: "pending" | "success" | "failure" | null,
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
  checks: [
    {
      name: "unit",
      workflow: "CI",
      state: checksState === "failure" ? "FAILURE" : "SUCCESS",
      bucket: checksState === "failure" ? "fail" : "pass",
      link: "https://github.com/o/r/actions/runs/1",
      startedAt: "2026-01-01T10:00:00Z",
      completedAt: "2026-01-01T10:01:30Z",
      description: null,
    },
    {
      name: "lint",
      workflow: "CI",
      state: checksState === "failure" ? "FAILURE" : "SUCCESS",
      bucket: checksState === "failure" ? "fail" : "pass",
      link: "https://github.com/o/r/actions/runs/2",
      startedAt: "2026-01-01T10:00:00Z",
      completedAt: "2026-01-01T10:00:45Z",
      description: null,
    },
  ],
  merged: null,
});

const controllerWith = (
  overrides: Record<string, unknown> = {},
): import("./use-session-pull-request").SessionPullRequestController => ({
  status: null,
  loading: false,
  creating: false,
  merging: false,
  refresh: mock(async () => undefined),
  create: mock(async () => ({
    number: 42,
    url: "https://github.com/o/r/pull/42",
    state: "OPEN" as const,
    created: true,
  })),
  merge: mock(async () => openPrStatus("success")),
  ...overrides,
});

beforeEach(() => {
  window.open = mock(() => null) as unknown as typeof window.open;
});

afterEach(() => {
  cleanup();
});

describe("SessionGitPrControls · create split button", () => {
  test("renders nothing on the default branch", () => {
    render(
      <SessionGitPrControls
        gitStatus={gitStatusWith({ branch: "main", isOnDefaultBranch: true })}
        pr={controllerWith()}
      />,
    );
    expect(screen.queryByTestId("session-create-pr")).toBeNull();
  });

  test("renders nothing when there are no changes and the branch is not ahead", () => {
    render(
      <SessionGitPrControls
        gitStatus={gitStatusWith({ dirty: false, aheadOfBase: 0 })}
        pr={controllerWith()}
      />,
    );
    expect(screen.queryByTestId("session-create-pr")).toBeNull();
  });

  test("renders the split button when ahead of base without uncommitted changes", () => {
    render(
      <SessionGitPrControls
        gitStatus={gitStatusWith({ dirty: false, aheadOfBase: 2 })}
        pr={controllerWith()}
      />,
    );
    expect(screen.getByTestId("session-create-pr-primary")).toBeDefined();
    expect(screen.getByTestId("session-create-pr-caret")).toBeDefined();
  });

  test("is disabled with a tooltip when the GitHub CLI is unavailable", () => {
    render(
      <SessionGitPrControls
        gitStatus={gitStatusWith({ ghAvailable: false })}
        pr={controllerWith()}
      />,
    );
    const primary = screen.getByTestId("session-create-pr-primary") as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.title).toContain("GitHub CLI unavailable");
    const caret = screen.getByTestId("session-create-pr-caret") as HTMLButtonElement;
    expect(caret.disabled).toBe(true);
  });

  test("caret opens the menu with Create PR checked, draft, and manual options", () => {
    render(<SessionGitPrControls gitStatus={gitStatusWith()} pr={controllerWith()} />);
    fireEvent.click(screen.getByTestId("session-create-pr-caret"));
    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("Create PR");
    expect(menu.textContent).toContain("Create draft PR");
    expect(menu.textContent).toContain("Manually create PR");
    const defaultItem = screen.getByRole("menuitem", { name: /Create PR$/ });
    expect(defaultItem.getAttribute("aria-current")).toBe("true");
  });

  test("primary button creates a PR and toasts with the PR link", async () => {
    const pr = controllerWith();
    const onToast = mock(() => undefined);
    const onChanged = mock(() => undefined);
    render(
      <SessionGitPrControls
        gitStatus={gitStatusWith()}
        pr={pr}
        onToast={onToast}
        onChanged={onChanged}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("session-create-pr-primary"));
    });
    expect(pr.create).toHaveBeenCalledWith("create");
    expect(onToast).toHaveBeenCalledWith("PR #42 created", {
      url: "https://github.com/o/r/pull/42",
      label: "#42",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  test("manual option pushes and opens the compare URL in a new tab", async () => {
    const pr = controllerWith({
      create: mock(async () => ({
        compareUrl: "https://github.com/o/r/compare/main...demo-branch?expand=1",
        created: false,
      })),
    });
    render(<SessionGitPrControls gitStatus={gitStatusWith()} pr={pr} />);
    fireEvent.click(screen.getByTestId("session-create-pr-caret"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Manually create PR/ }));
    });
    expect(pr.create).toHaveBeenCalledWith("manual");
    expect(window.open).toHaveBeenCalledWith(
      "https://github.com/o/r/compare/main...demo-branch?expand=1",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("default-branch refusal surfaces the worktree hint", async () => {
    const pr = controllerWith({
      create: mock(async () => {
        throw Object.assign(new Error("Create a worktree first"), { code: "ON_DEFAULT_BRANCH" });
      }),
    });
    const onToast = mock(() => undefined);
    render(<SessionGitPrControls gitStatus={gitStatusWith()} pr={pr} onToast={onToast} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("session-create-pr-primary"));
    });
    expect(onToast).toHaveBeenCalledWith("Create a worktree first");
  });

  test("shows the working indicator while creating", () => {
    const pr = controllerWith({ creating: true });
    render(<SessionGitPrControls gitStatus={gitStatusWith()} pr={pr} />);
    expect(screen.getByTestId("working-indicator").textContent).toContain("Creating PR…");
  });
});

describe("SessionGitPrControls · checks button", () => {
  const openGitStatus = () =>
    gitStatusWith({
      pr: { number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN", title: "Demo PR" },
      prState: "open",
    });

  test("pending checks render the pulsing amber running state", () => {
    const pr = controllerWith({ status: openPrStatus("pending") });
    render(<SessionGitPrControls gitStatus={openGitStatus()} pr={pr} />);
    const button = screen.getByTestId("session-checks-button");
    expect(button.getAttribute("data-state")).toBe("pending");
    expect(button.textContent).toBe("Checks · running");
    expect(button.querySelector(".pulse")).not.toBeNull();
    expect(button.className).toContain("status-ready");
  });

  test("failure renders red with the failing count", () => {
    const pr = controllerWith({ status: openPrStatus("failure") });
    render(<SessionGitPrControls gitStatus={openGitStatus()} pr={pr} />);
    const button = screen.getByTestId("session-checks-button");
    expect(button.getAttribute("data-state")).toBe("failure");
    expect(button.textContent).toBe("Checks · 2 failing");
    expect(button.className).toContain("status-blocked");
  });

  test("success without mergeable keeps the green checks button", () => {
    const pr = controllerWith({ status: openPrStatus("success", "CONFLICTING") });
    render(<SessionGitPrControls gitStatus={openGitStatus()} pr={pr} />);
    const button = screen.getByTestId("session-checks-button");
    expect(button.getAttribute("data-state")).toBe("success");
    expect(button.textContent).toBe("Checks · passing");
    expect(button.className).toContain("status-success");
  });

  test("clicking the checks button opens the checks popup", () => {
    const pr = controllerWith({ status: openPrStatus("pending") });
    render(<SessionGitPrControls gitStatus={openGitStatus()} pr={pr} />);
    fireEvent.click(screen.getByTestId("session-checks-button"));
    expect(screen.getByTestId("session-checks-popup")).toBeDefined();
    expect(screen.getByTestId("session-checks-popup-title").textContent).toContain("Demo PR · #42");
  });
});

describe("SessionGitPrControls · merge", () => {
  const mergeableGitStatus = () =>
    gitStatusWith({
      dirty: false,
      aheadOfBase: 3,
      pr: { number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN", title: "Demo PR" },
      prState: "open",
    });

  test("green Merge button replaces checks only when checks pass and PR is mergeable", () => {
    const pr = controllerWith({ status: openPrStatus("success") });
    render(<SessionGitPrControls gitStatus={mergeableGitStatus()} pr={pr} />);
    expect(screen.getByTestId("session-merge-primary")).toBeDefined();
    expect(screen.queryByTestId("session-checks-button")).toBeNull();
  });

  test("a mergeable PR with no CI checks can still be merged", () => {
    const pr = controllerWith({ status: openPrStatus(null) });
    render(<SessionGitPrControls gitStatus={mergeableGitStatus()} pr={pr} />);
    expect(screen.getByTestId("session-merge-primary")).toBeDefined();
    expect(screen.queryByTestId("session-checks-button")).toBeNull();
  });

  test("primary Merge asks for confirmation, then merges with squash by default", async () => {
    const pr = controllerWith({ status: openPrStatus("success") });
    const onChanged = mock(() => undefined);
    render(<SessionGitPrControls gitStatus={mergeableGitStatus()} pr={pr} onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId("session-merge-primary"));
    expect(screen.getByText(/Merge PR #42 with squash/)).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    expect(pr.merge).toHaveBeenCalledWith("squash");
    expect(onChanged).toHaveBeenCalled();
  });

  test("cancelling the confirmation skips the merge call", async () => {
    const pr = controllerWith({ status: openPrStatus("success") });
    render(<SessionGitPrControls gitStatus={mergeableGitStatus()} pr={pr} />);
    fireEvent.click(screen.getByTestId("session-merge-primary"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    });
    expect(pr.merge).not.toHaveBeenCalled();
  });

  test("caret menu lists the three methods with squash checked and merges with the selection", async () => {
    const pr = controllerWith({ status: openPrStatus("success") });
    render(<SessionGitPrControls gitStatus={mergeableGitStatus()} pr={pr} />);
    fireEvent.click(screen.getByTestId("session-merge-caret"));
    const squashItem = screen.getByRole("menuitem", { name: "Squash" });
    expect(squashItem.getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rebase" }));
    // Selecting a method opens the confirmation for that method.
    expect(screen.getByText(/Merge PR #42 with rebase/)).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    expect(pr.merge).toHaveBeenCalledWith("rebase");
  });

  test("not-mergeable errors surface a toast", async () => {
    const pr = controllerWith({
      status: openPrStatus("success"),
      merge: mock(async () => {
        throw Object.assign(new Error("not mergeable"), { code: "NOT_MERGEABLE" });
      }),
    });
    const onToast = mock(() => undefined);
    render(<SessionGitPrControls gitStatus={mergeableGitStatus()} pr={pr} onToast={onToast} />);
    fireEvent.click(screen.getByTestId("session-merge-primary"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith("GitHub says this PR is not mergeable yet"),
    );
  });

  test("failed-check errors surface a distinct toast", async () => {
    const pr = controllerWith({
      status: openPrStatus("success"),
      merge: mock(async () => {
        throw Object.assign(new Error("required status check has not passed"), {
          code: "CHECKS_FAILING",
        });
      }),
    });
    const onToast = mock(() => undefined);
    render(<SessionGitPrControls gitStatus={mergeableGitStatus()} pr={pr} onToast={onToast} />);
    fireEvent.click(screen.getByTestId("session-merge-primary"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith("Required checks have not passed yet"),
    );
  });

  test("renders nothing once the PR is merged", () => {
    const fixturePr = openPrStatus("success").pr;
    if (!fixturePr) throw new Error("expected fixture PR");
    const mergedStatus: SessionPullRequestStatus = {
      ...openPrStatus("success"),
      pr: { ...fixturePr, state: "MERGED" },
      checksState: null,
      merged: null,
    };
    const pr = controllerWith({ status: mergedStatus });
    const { container } = render(
      <SessionGitPrControls
        gitStatus={gitStatusWith({
          pr: {
            number: 42,
            url: "https://github.com/o/r/pull/42",
            state: "MERGED",
            title: "Demo PR",
          },
          prState: "merged",
        })}
        pr={pr}
      />,
    );
    expect(container.querySelector("[data-testid^='session-']")).toBeNull();
  });
});
