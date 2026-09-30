import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, renderHook, screen } = await import(
  "@testing-library/react"
);
const {
  coordinatorPath,
  Link,
  navigate,
  parseRoute,
  projectPath,
  projectSettingsPath,
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
    expect(parseRoute("/projects/p1/chat")).toEqual({ name: "coordinator", projectId: "p1" });
    expect(parseRoute("/projects/p1/settings")).toEqual({
      name: "project-settings",
      projectId: "p1",
    });
    expect(parseRoute("/projects/p1/threads/t1")).toEqual({
      name: "thread",
      projectId: "p1",
      threadId: "t1",
    });
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
    expect(parseRoute(coordinatorPath(id))).toEqual({ name: "coordinator", projectId: id });
    expect(parseRoute(projectSettingsPath(id))).toEqual({
      name: "project-settings",
      projectId: id,
    });
    expect(parseRoute(threadPath(id, "t/1"))).toEqual({
      name: "thread",
      projectId: id,
      threadId: "t/1",
    });
  });

  test("routeProjectId is the project a route belongs to, or null", () => {
    expect(routeProjectId({ name: "projects" })).toBeNull();
    expect(routeProjectId({ name: "coordinator", projectId: "p1" })).toBe("p1");
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
    expect(result.current).toEqual({ name: "coordinator", projectId: "p2" });
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
