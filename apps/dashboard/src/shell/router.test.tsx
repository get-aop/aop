import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, renderHook, screen } = await import(
  "@testing-library/react"
);
const {
  Link,
  navigate,
  PROJECT_SETTINGS_SECTIONS,
  parseRoute,
  projectPath,
  projectScreenPath,
  projectSettingsPath,
  projectTabPath,
  routeProjectId,
  threadPath,
  useRoute,
} = await import("./router");

beforeEach(() => window.history.pushState({}, "", "/"));
afterEach(cleanup);

describe("parseRoute", () => {
  test("names every screen", () => {
    expect(parseRoute("/")).toEqual({ name: "projects" });
    expect(parseRoute("/projects/p1")).toEqual({ name: "project", projectId: "p1" });
    expect(parseRoute("/projects/p1/")).toEqual({ name: "project", projectId: "p1" });
    expect(parseRoute("/projects/p1/chat")).toEqual({ name: "project", projectId: "p1" });
    expect(parseRoute("/projects/p1/settings")).toEqual({
      name: "project-settings",
      projectId: "p1",
      section: "general",
    });
    expect(parseRoute("/projects/p1/threads/t1")).toEqual({
      name: "thread",
      projectId: "p1",
      threadId: "t1",
    });
  });

  test("names each section of a project's settings, and General only by the bare address", () => {
    for (const section of PROJECT_SETTINGS_SECTIONS.filter((id) => id !== "general")) {
      expect(parseRoute(`/projects/p1/settings/${section}`)).toEqual({
        name: "project-settings",
        projectId: "p1",
        section,
      });
    }
    expect(parseRoute("/projects/p1/settings/general")).toBeNull();
    expect(parseRoute("/projects/p1/settings/billing")).toBeNull();
    // The addresses from before the sections split still open the same screens.
    for (const old of ["memory", "environment", "usage"]) {
      expect(parseRoute(`/projects/p1/settings/${old}`)).not.toBeNull();
    }
    expect(parseRoute("/projects/p1/settings/usage/extra")).toBeNull();
  });

  test("returns null for a path no screen owns", () => {
    for (const path of [
      "/chat",
      "/workflows/x",
      "/tasks/1",
      "/projects",
      "/projects/p1/nope",
      "/projects/p1/threads",
    ]) {
      expect(parseRoute(path)).toBeNull();
    }
  });

  test("path builders and the parser agree, including ids that need escaping", () => {
    const id = "proj/odd id";
    expect(parseRoute(projectPath(id))).toEqual({ name: "project", projectId: id });
    expect(parseRoute(projectSettingsPath(id))).toEqual({
      name: "project-settings",
      projectId: id,
      section: "general",
    });
    expect(parseRoute(projectSettingsPath(id, "usage"))).toEqual({
      name: "project-settings",
      projectId: id,
      section: "usage",
    });
    expect(parseRoute(threadPath(id, "t/1"))).toEqual({
      name: "thread",
      projectId: id,
      threadId: "t/1",
    });
  });

  test("a project or thread screen may name a pull request shown in the chat's place", () => {
    const pullRequest = { repoId: "repo_1", number: 752 };
    expect(parseRoute("/projects/p1/pulls/repo_1/752")).toEqual({
      name: "project",
      projectId: "p1",
      pullRequest,
    });
    expect(parseRoute("/projects/p1/threads/t1/pulls/repo_1/752")).toEqual({
      name: "thread",
      projectId: "p1",
      threadId: "t1",
      pullRequest,
    });
    for (const path of [
      "/projects/p1/pulls/repo_1",
      "/projects/p1/pulls/repo_1/0",
      "/projects/p1/pulls/repo_1/07",
      "/projects/p1/pulls/repo_1/7x",
      "/projects/p1/pulls/repo_1/99999999999999999999",
      "/projects/p1/chat/pulls/repo_1/7",
      "/projects/p1/settings/pulls/repo_1/7",
      "/projects/p1/threads/pulls/repo_1/7",
      "/projects/p1/pulls/repo_1/7/files",
    ]) {
      expect(parseRoute(path)).toBeNull();
    }
  });

  test("projectScreenPath and the parser agree, with and without a pull request", () => {
    const screens = [
      { name: "project", projectId: "p 1" },
      { name: "thread", projectId: "p1", threadId: "t/1" },
      { name: "project", projectId: "p1", pullRequest: { repoId: "repo/x", number: 3 } },
      { name: "thread", projectId: "p1", threadId: "t1", pullRequest: { repoId: "r", number: 9 } },
      { name: "project-tab", projectId: "p1", tab: "pull-requests" },
      {
        name: "project-tab",
        projectId: "p1",
        tab: "pull-requests",
        pullRequest: { repoId: "r", number: 4 },
      },
    ] as const;
    for (const screen of screens) {
      expect(parseRoute(projectScreenPath(screen))).toEqual(screen);
    }
    expect(projectScreenPath(screens[2])).toBe("/projects/p1/pulls/repo%2Fx/3");
  });

  test("a tab of the panel has its own address, and only a known tab does", () => {
    expect(parseRoute("/projects/p1/pull-requests")).toEqual({
      name: "project-tab",
      projectId: "p1",
      tab: "pull-requests",
    });
    expect(projectTabPath("p1", "pull-requests")).toBe("/projects/p1/pull-requests");
    expect(parseRoute("/projects/p1/no-such-tab")).toBeNull();
    expect(parseRoute("/projects/p1/pull-requests/extra")).toBeNull();
    // Threads is the project screen itself, not a tab address.
    expect(parseRoute("/projects/p1/threads")).toBeNull();
  });

  test("a project or thread screen may name the browser shown in the chat's place", () => {
    expect(parseRoute("/projects/p1/browser")).toEqual({
      name: "project",
      projectId: "p1",
      browser: true,
    });
    expect(parseRoute("/projects/p1/threads/t1/browser")).toEqual({
      name: "thread",
      projectId: "p1",
      threadId: "t1",
      browser: true,
    });
    expect(parseRoute("/projects/p1/issues/browser")).toEqual({
      name: "project-tab",
      projectId: "p1",
      tab: "issues",
      browser: true,
    });
    // A thread whose id happens to be "browser" is still that thread.
    expect(parseRoute("/projects/p1/threads/browser")).toEqual({
      name: "thread",
      projectId: "p1",
      threadId: "browser",
    });
    for (const path of [
      "/projects/p1/chat/browser",
      "/projects/p1/settings/browser",
      "/projects/p1/browser/x",
      "/projects/p1/pulls/repo_1/7/browser",
    ]) {
      expect(parseRoute(path)).toBeNull();
    }
    for (const screen of [
      { name: "project", projectId: "p 1", browser: true },
      { name: "thread", projectId: "p1", threadId: "t/1", browser: true },
      { name: "project-tab", projectId: "p1", tab: "routines", browser: true },
    ] as const) {
      expect(parseRoute(projectScreenPath(screen))).toEqual(screen);
    }
  });

  test("routeProjectId is the project a route belongs to, or null", () => {
    expect(routeProjectId({ name: "projects" })).toBeNull();
    expect(routeProjectId({ name: "project", projectId: "p1" })).toBe("p1");
  });
});

describe("useRoute", () => {
  test("follows navigate() and the back button", () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: "projects" });

    act(() => navigate("/projects/p1"));
    expect(result.current).toEqual({ name: "project", projectId: "p1" });

    act(() => {
      window.history.pushState({}, "", "/projects/p2/chat");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toEqual({ name: "project", projectId: "p2" });
  });

  test("the old chat address is rewritten to the project screen", () => {
    window.history.pushState({}, "", "/projects/p1/chat");
    const { result } = renderHook(() => useRoute());

    expect(result.current).toEqual({ name: "project", projectId: "p1" });
    expect(window.location.pathname).toBe("/projects/p1");
  });

  test("rewrites an address no screen owns to /, so the bar says what is shown", () => {
    window.history.pushState({}, "", "/workflows/old-bookmark");
    const { result } = renderHook(() => useRoute());

    expect(result.current).toEqual({ name: "projects" });
    expect(window.location.pathname).toBe("/");
  });

  test("navigate to the current path adds no history entry", () => {
    const before = window.history.length;
    navigate("/");
    expect(window.history.length).toBe(before);
  });
});

describe("Link", () => {
  test("navigates without a page load: the browser's own navigation is cancelled", () => {
    render(<Link to="/projects/p1">Open</Link>);
    const notCancelled = fireEvent.click(screen.getByText("Open"));
    expect(notCancelled).toBe(false);
    expect(window.location.pathname).toBe("/projects/p1");
  });

  test("leaves modified clicks to the browser, so a new tab still works", () => {
    render(<Link to="/projects/p1">Open</Link>);
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      expect(fireEvent.click(screen.getByText("Open"), modifier)).toBe(true);
    }
  });
});
