import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

import type { SessionMergedPullRequest } from "../../api/client";

const { render, screen, cleanup, fireEvent, within } = await import("@testing-library/react");
const { MergedPrBar } = await import("./MergedPrBar");
const { dismissMergedPrBar, isMergedPrBarDismissed, resetMergedPrBarDismissalForTests } =
  await import("./session-merged-pr-dismissal");

const mergedFixture = (): SessionMergedPullRequest => ({
  number: 42,
  url: "https://github.com/o/r/pull/42",
  title: "Add the session git bar",
  authorLogin: "octocat",
  additions: 128,
  deletions: 12,
  changedFiles: 9,
  mergedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  repoNameWithOwner: "o/r",
});

beforeEach(() => {
  localStorage.clear();
  resetMergedPrBarDismissalForTests();
});

afterEach(() => {
  cleanup();
});

describe("MergedPrBar", () => {
  test("renders the violet merged bar with link, repo, branch, Merged, and dismiss", () => {
    const onDismiss = mock(() => undefined);
    render(<MergedPrBar merged={mergedFixture()} branch="demo-branch" onDismiss={onDismiss} />);

    const bar = screen.getByTestId("merged-pr-bar");
    expect(bar.className).toContain("border-accent-violet-border");
    expect(bar.className).toContain("bg-accent-violet-fill");
    expect(bar.className).toContain("text-accent-violet");
    expect(bar.className).not.toContain("merged-pr-celebration");
    expect(bar.textContent).toContain("o/r");
    expect(bar.textContent).toContain("demo-branch");
    expect(bar.textContent).toContain("Merged");

    const link = screen.getByTestId("merged-pr-link");
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/42");
    expect(link.textContent).toBe("#42");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss merged pull request bar" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  test("hovering the PR number opens the hover card with the full payload", () => {
    render(
      <MergedPrBar merged={mergedFixture()} branch="demo-branch" onDismiss={() => undefined} />,
    );
    expect(screen.queryByTestId("pr-hover-card")).toBeNull();

    fireEvent.mouseEnter(screen.getByTestId("merged-pr-link"));
    const card = screen.getByTestId("pr-hover-card");
    expect(card.textContent).toContain("Merged");
    expect(card.textContent).toContain("o/r #42");
    expect(card.textContent).toContain("3h ago");
    expect(card.textContent).toContain("Add the session git bar");
    expect(card.textContent).toContain("octocat");
    expect(card.textContent).toContain("+128");
    expect(card.textContent).toContain("−12");
    expect(card.textContent).toContain("9 files");

    const mergedBadge = within(card).getByText("Merged");
    expect(mergedBadge.className).toContain("border-accent-violet-border");
    const filesBadge = within(card).getByText("9 files");
    expect(filesBadge.className).toBeTruthy();

    const title = screen.getByRole("link", { name: "Add the session git bar" });
    expect(title.getAttribute("href")).toBe("https://github.com/o/r/pull/42");
    expect(title.className).toContain("underline");

    const avatar = card.querySelector("img");
    expect(avatar?.getAttribute("src")).toBe("https://github.com/octocat.png");

    fireEvent.mouseLeave(screen.getByTestId("merged-pr-link"));
    expect(screen.queryByTestId("pr-hover-card")).toBeNull();
  });

  test("keeps a hover bridge between the PR link and its card", () => {
    render(
      <MergedPrBar merged={mergedFixture()} branch="demo-branch" onDismiss={() => undefined} />,
    );

    fireEvent.mouseEnter(screen.getByTestId("merged-pr-link"));
    const hoverRegion = screen.getByTestId("pr-hover-region");
    expect(hoverRegion.className).toContain("pb-1");

    fireEvent.mouseLeave(screen.getByTestId("merged-pr-link"), {
      relatedTarget: hoverRegion,
    });
    fireEvent.mouseEnter(hoverRegion);
    expect(screen.getByTestId("pr-hover-card")).toBeTruthy();
  });

  test("opens PR links through the desktop external URL bridge", async () => {
    const openLink = mock(async () => undefined);
    render(
      <MergedPrBar
        merged={mergedFixture()}
        branch="demo-branch"
        onDismiss={() => undefined}
        desktop
        openLink={openLink}
      />,
    );

    fireEvent.click(screen.getByTestId("merged-pr-link"));
    await Promise.resolve();
    expect(openLink).toHaveBeenCalledWith("https://github.com/o/r/pull/42");
  });

  test("keeps the hover card open while keyboard focus moves to its title link", () => {
    render(
      <MergedPrBar merged={mergedFixture()} branch="demo-branch" onDismiss={() => undefined} />,
    );
    const prLink = screen.getByTestId("merged-pr-link");
    fireEvent.focus(prLink);
    const titleLink = screen.getByRole("link", { name: "Add the session git bar" });
    fireEvent.blur(prLink, { relatedTarget: titleLink });
    fireEvent.focus(titleLink);
    expect(screen.getByTestId("pr-hover-card")).toBeTruthy();
  });

  test("does not render the impossible phrase now ago", () => {
    render(
      <MergedPrBar
        merged={{ ...mergedFixture(), mergedAt: new Date().toISOString() }}
        branch="demo-branch"
        onDismiss={() => undefined}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId("merged-pr-link"));
    expect(screen.getByTestId("pr-hover-card").textContent).not.toContain("now ago");
  });

  test("dismissal persists per session across a simulated reload", () => {
    expect(isMergedPrBarDismissed("s1", 42)).toBe(false);
    dismissMergedPrBar("s1", 42);
    resetMergedPrBarDismissalForTests();
    expect(isMergedPrBarDismissed("s1", 42)).toBe(true);
    // A new PR number for the same session shows the bar again.
    expect(isMergedPrBarDismissed("s1", 43)).toBe(false);
  });
});
