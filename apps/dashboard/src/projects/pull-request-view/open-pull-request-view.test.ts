import { beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { closePullRequestView, openPullRequestView } = await import("./open-pull-request-view");

const target = { projectId: "p1", repoId: "repo_1", number: 752 };

beforeEach(() => window.history.pushState({}, "", "/projects/p1"));

describe("openPullRequestView", () => {
  test("shows the pull request in a new history entry on the project screen", () => {
    const before = window.history.length;
    openPullRequestView(target);
    expect(window.location.pathname).toBe("/projects/p1/pulls/repo_1/752");
    expect(window.history.length).toBe(before + 1);
  });

  test("keeps the thread open in the panel beside it", () => {
    window.history.pushState({}, "", "/projects/p1/threads/t1");
    openPullRequestView(target);
    expect(window.location.pathname).toBe("/projects/p1/threads/t1/pulls/repo_1/752");
  });

  test("replaces a pull request already shown, keeping the thread", () => {
    window.history.pushState({}, "", "/projects/p1/threads/t1/pulls/repo_1/752");
    openPullRequestView({ ...target, repoId: "repo_2", number: 8 });
    expect(window.location.pathname).toBe("/projects/p1/threads/t1/pulls/repo_2/8");
  });

  test("keeps the panel's tab open beside it", () => {
    window.history.pushState({}, "", "/projects/p1/pull-requests");
    openPullRequestView(target);
    expect(window.location.pathname).toBe("/projects/p1/pull-requests/pulls/repo_1/752");
  });

  test("opens on another project's home: that project's thread is not this one's", () => {
    window.history.pushState({}, "", "/projects/p2/threads/t9");
    openPullRequestView(target);
    expect(window.location.pathname).toBe("/projects/p1/pulls/repo_1/752");
  });

  test("tells the app the address changed", () => {
    let heard = 0;
    const listener = () => {
      heard += 1;
    };
    window.addEventListener("aop:navigate", listener);
    openPullRequestView(target);
    window.removeEventListener("aop:navigate", listener);
    expect(heard).toBe(1);
  });
});

describe("closePullRequestView", () => {
  test("gives the chat its place back and leaves the panel as it was", () => {
    window.history.pushState({}, "", "/projects/p1/threads/t1/pulls/repo_1/752");
    closePullRequestView();
    expect(window.location.pathname).toBe("/projects/p1/threads/t1");

    window.history.pushState({}, "", "/projects/p1/pulls/repo_1/752");
    closePullRequestView();
    expect(window.location.pathname).toBe("/projects/p1");

    window.history.pushState({}, "", "/projects/p1/pull-requests/pulls/repo_1/752");
    closePullRequestView();
    expect(window.location.pathname).toBe("/projects/p1/pull-requests");
  });

  test("does nothing where no pull request is shown", () => {
    const before = window.history.length;
    closePullRequestView();
    expect(window.location.pathname).toBe("/projects/p1");
    expect(window.history.length).toBe(before);
  });
});
