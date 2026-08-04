import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

import type { SessionPullRequestStatus } from "../../api/client";

const { render, screen, cleanup, fireEvent } = await import("@testing-library/react");
const { SessionChecksPopup, formatCheckDuration } = await import("./SessionChecksPopup");

const statusFixture = (): SessionPullRequestStatus => ({
  pr: {
    number: 42,
    url: "https://github.com/o/r/pull/42",
    title: "Demo PR",
    state: "OPEN",
    mergeable: "MERGEABLE",
    baseRefName: "main",
    headRefName: "demo-branch",
  },
  checksState: "pending",
  checks: [
    {
      name: "unit",
      workflow: "CI",
      state: "SUCCESS",
      bucket: "pass",
      link: "https://github.com/o/r/actions/runs/1",
      startedAt: "2026-01-01T10:00:00Z",
      completedAt: "2026-01-01T10:01:30Z",
      description: "1,204 passed",
    },
    {
      name: "e2e",
      workflow: "CI",
      state: "IN_PROGRESS",
      bucket: "pending",
      link: "https://github.com/o/r/actions/runs/2",
      startedAt: "2026-01-01T10:00:00Z",
      completedAt: null,
      description: null,
    },
    {
      name: "lint",
      workflow: "Lint",
      state: "FAILURE",
      bucket: "fail",
      link: "https://github.com/o/r/actions/runs/3",
      startedAt: "2026-01-01T10:00:00Z",
      completedAt: "2026-01-01T10:00:45Z",
      description: "biome check",
    },
  ],
  merged: null,
});

afterEach(() => {
  cleanup();
});

describe("SessionChecksPopup", () => {
  test("groups check runs by workflow with status, duration, and deep links", () => {
    render(<SessionChecksPopup open status={statusFixture()} onClose={() => undefined} />);
    const groups = screen.getAllByTestId("session-checks-group");
    expect(groups.map((group) => group.querySelector("h3")?.textContent)).toEqual(["CI", "Lint"]);

    const rows = screen.getAllByTestId("session-check-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.getAttribute("data-state")).toBe("success");
    expect(rows[0]?.textContent).toContain("unit");
    expect(rows[0]?.textContent).toContain("1m 30s");
    expect(rows[0]?.textContent).toContain("1,204 passed");
    expect(rows[1]?.getAttribute("data-state")).toBe("pending");
    expect(rows[1]?.textContent).toContain("running");
    expect(rows[2]?.getAttribute("data-state")).toBe("failure");
    expect(rows[2]?.textContent).toContain("45s");

    const link = screen.getByRole("link", { name: "Open unit on GitHub" });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/actions/runs/1");
  });

  test("header shows the PR title and number; footer offers Open on GitHub", () => {
    const onClose = mock(() => undefined);
    render(<SessionChecksPopup open status={statusFixture()} onClose={onClose} />);
    expect(screen.getByTestId("session-checks-popup-title").textContent).toContain("Demo PR · #42");
    fireEvent.click(screen.getByTestId("session-checks-open-github"));
    // window.open is not implemented in happy-dom; the button must exist and be clickable.
    expect(screen.getByTestId("session-checks-open-github")).toBeDefined();
  });

  test("opens the PR and check links through the desktop external URL bridge", async () => {
    const openLink = mock(async () => undefined);
    render(
      <SessionChecksPopup
        open
        status={statusFixture()}
        onClose={() => undefined}
        desktop
        openLink={openLink}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open unit on GitHub" }));
    fireEvent.click(screen.getByTestId("session-checks-open-github"));
    await Promise.resolve();

    expect(openLink).toHaveBeenNthCalledWith(1, "https://github.com/o/r/actions/runs/1");
    expect(openLink).toHaveBeenNthCalledWith(2, "https://github.com/o/r/pull/42");
  });

  test("close button and Escape both dismiss the popup", () => {
    const onClose = mock(() => undefined);
    render(<SessionChecksPopup open status={statusFixture()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.keyDown(screen.getByTestId("session-checks-popup"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("renders the empty state when a PR has no checks", () => {
    render(
      <SessionChecksPopup
        open
        status={{ ...statusFixture(), checks: [] }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId("session-checks-empty").textContent).toContain("No checks");
  });

  test("renders nothing while closed", () => {
    render(<SessionChecksPopup open={false} status={statusFixture()} onClose={() => undefined} />);
    expect(screen.queryByTestId("session-checks-popup")).toBeNull();
  });

  test("never embeds github.com in an iframe", () => {
    const { container } = render(
      <SessionChecksPopup open status={statusFixture()} onClose={() => undefined} />,
    );
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("formatCheckDuration", () => {
  test("formats queued, running, seconds, and minutes", () => {
    expect(formatCheckDuration(null, null)).toBe("queued");
    expect(formatCheckDuration("2026-01-01T10:00:00Z", null)).toBe("running");
    expect(formatCheckDuration("2026-01-01T10:00:00Z", "2026-01-01T10:00:45Z")).toBe("45s");
    expect(formatCheckDuration("2026-01-01T10:00:00Z", "2026-01-01T10:01:30Z")).toBe("1m 30s");
    expect(formatCheckDuration("2026-01-01T10:00:00Z", "2026-01-01T10:02:00Z")).toBe("2m");
  });
});
