import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Project, Thread } from "@aop/common";
import {
  FakeEventSource,
  makeProject,
  makeThread,
  projectEntry,
  threadEntry,
} from "./projects/test-utils";
import { setupDashboardDom } from "./test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { App } = await import("./App");

/** The dashboard against a scripted host: REST answers, and one hand-driven event stream per project. */
class TestEventSource extends FakeEventSource {
  static instances: TestEventSource[] = [];
  constructor(url: string, init?: { withCredentials?: boolean }) {
    super(url, init?.withCredentials ?? false);
    TestEventSource.instances.push(this);
  }
}

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

let projects: Project[];
let threads: Record<string, Thread[]>;
let principal: () => Response;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
  TestEventSource.instances = [];
  projects = [makeProject({ id: "p1", name: "Checkout" })];
  threads = { p1: [] };
  principal = () => Response.json({ kind: "owner" });
  globalThis.EventSource = TestEventSource as unknown as typeof EventSource;
  globalThis.fetch = mock(async (input: string | URL | Request) =>
    answer(String(input)),
  ) as unknown as typeof fetch;
});

const answer = (url: string): Response => {
  if (url === "/api/auth/me") return principal();
  if (url === "/api/projects") return Response.json({ projects });
  if (url === "/api/status") return Response.json({ repos: [] });
  const [, projectId, listing] = /^\/api\/projects\/([^/]+)(\/threads)?$/.exec(url) ?? [];
  if (projectId && listing) return Response.json({ threads: threads[projectId] ?? [] });
  const found = projects.find(({ id }) => id === projectId);
  if (found) return Response.json({ project: found });
  return Response.json({ error: "Project not found" }, { status: 404 });
};

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
});

const streamOf = (projectId: string): TestEventSource => {
  const found = TestEventSource.instances.findLast((source) =>
    source.url.includes(`/projects/${projectId}/stream`),
  );
  if (!found) throw new Error(`no stream open for ${projectId}`);
  return found;
};

describe("App routing", () => {
  test("opens the projects screen at /, with the sidebar as the only chrome", async () => {
    render(<App />);

    expect(await screen.findByTestId("projects-index")).toBeTruthy();
    expect(await screen.findByTestId("project-card")).toBeTruthy();
    expect(screen.getByTestId("projects-sidebar")).toBeTruthy();
    expect(screen.getByTestId("sidebar-new-project")).toBeTruthy();
    expect(screen.getByTestId("sidebar-settings")).toBeTruthy();
    expect(screen.queryByTestId("sessions-page")).toBeNull();
  });

  test("a project's address opens its home, and its stream fills the grid", async () => {
    window.history.pushState({}, "", "/projects/p1");
    render(<App />);

    expect(await screen.findByTestId("project-page")).toBeTruthy();
    await waitFor(() => expect(TestEventSource.instances.length).toBeGreaterThan(0));
    threads.p1 = [
      makeThread({ id: "t1", projectId: "p1", title: "Pick a database", status: "waiting-on-you" }),
    ];
    act(() => {
      streamOf("p1").open();
      streamOf("p1").emit("resync", { cursor: 3, reason: "start" }, "3");
    });

    const card = await screen.findByTestId("thread-card");
    expect(within(card).getByTestId("thread-status-line").textContent).toBe(
      "Blocked · Which database?",
    );
    expect(screen.getByTestId("project-attention").textContent).toBe("1 thread is waiting on you.");
    expect(
      within(screen.getByTestId("projects-sidebar")).getByTestId("project-attention-waiting")
        .textContent,
    ).toBe("1");
  });

  test("a card changes in place when the stream delivers a new state, with no reload", async () => {
    threads.p1 = [makeThread({ id: "t1", projectId: "p1", title: "Fix login", status: "working" })];
    window.history.pushState({}, "", "/projects/p1");
    render(<App />);
    await screen.findByTestId("project-page");
    await waitFor(() => expect(TestEventSource.instances.length).toBeGreaterThan(0));
    act(() => streamOf("p1").emit("resync", { cursor: 1, reason: "start" }, "1"));
    expect((await screen.findByTestId("thread-card")).getAttribute("data-status")).toBe("working");

    act(() =>
      streamOf("p1").emit(
        "entry",
        threadEntry(
          2,
          makeThread({
            id: "t1",
            projectId: "p1",
            title: "Fix login",
            status: "ready-for-review",
            artifacts: [
              { type: "pr", number: 9, url: "https://github.com/a/b/pull/9", state: "open" },
            ],
          }),
        ),
        "2",
      ),
    );

    expect(screen.getByTestId("thread-card").getAttribute("data-status")).toBe("ready-for-review");
    expect(screen.getByTestId("thread-pr-chip").textContent).toBe("#9");
    expect(screen.getAllByTestId("thread-card")).toHaveLength(1);
  });

  test("a project renamed on another device is renamed here", async () => {
    window.history.pushState({}, "", "/projects/p1");
    render(<App />);
    await screen.findByTestId("project-page");
    await waitFor(() => expect(TestEventSource.instances.length).toBeGreaterThan(0));

    act(() =>
      streamOf("p1").emit(
        "entry",
        projectEntry(
          2,
          makeProject({ id: "p1", name: "Renamed", updatedAt: "2026-09-29T12:00:00.000Z" }),
        ),
        "2",
      ),
    );

    expect(screen.getByTestId("project-title").textContent).toBe("Renamed");
  });

  test("navigating between projects keeps a stream on the open one", async () => {
    projects = [
      makeProject({ id: "p1", name: "Checkout" }),
      makeProject({ id: "p2", name: "Storefront" }),
    ];
    render(<App />);
    expect(await screen.findAllByTestId("project-card")).toHaveLength(2);

    fireEvent.click(within(screen.getByTestId("projects-sidebar")).getByText("Storefront"));

    expect(window.location.pathname).toBe("/projects/p2");
    expect((await screen.findByTestId("project-title")).textContent).toBe("Storefront");
    expect(streamOf("p2").closed).toBe(false);
  });

  test("an unknown project is a plain not-found", async () => {
    window.history.pushState({}, "", "/projects/nope");
    render(<App />);
    expect(await screen.findByTestId("project-not-found")).toBeTruthy();
  });

  for (const path of [
    "/chat",
    "/pool",
    "/workers",
    "/metrics",
    "/workflows",
    "/settings",
    "/tasks/task-1",
    "/workflows/some-id",
  ]) {
    test(`an old address (${path}) is rewritten to the projects screen`, async () => {
      window.history.pushState({}, "", path);
      render(<App />);

      expect(await screen.findByTestId("projects-index")).toBeTruthy();
      expect(window.location.pathname).toBe("/");
    });
  }
});

describe("App pairing gate", () => {
  test("a device without a token sees the pairing screen and no project data is requested", async () => {
    principal = () =>
      Response.json({ error: "Authentication required", code: "UNAUTHENTICATED" }, { status: 401 });
    render(<App />);

    expect(await screen.findByTestId("pairing-screen")).toBeTruthy();
    expect(screen.queryByTestId("projects-sidebar")).toBeNull();
    const requested = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.map(
      ([url]) => String(url),
    );
    expect(requested).toEqual(["/api/auth/me"]);
    expect(TestEventSource.instances).toHaveLength(0);
  });
});
