import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { at, reply } from "./chat/test-utils";
import type { ProjectsState } from "./projects-state";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "./test-utils";
import { hostError, json, mockHost } from "./thread/test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { ProjectsProvider } = await import("./ProjectsProvider");
const { ProjectPage } = await import("./ProjectPage");
const { ChatApiProvider } = await import("./chat/chat-api");
type Route = import("../shell/router").Route;
type ChatApi = import("./chat/chat-api").ChatApi;

// The chat asks the host for its messages when a project opens; these tests are about the
// page, so the host never answers and the chat stays loading.
const silentHost: ChatApi = {
  listMessages: () => new Promise(() => {}),
  sendMessage: () => new Promise(() => {}),
  startSuggestion: () => new Promise(() => {}),
  skipSuggestion: () => new Promise(() => {}),
  unskipSuggestion: () => new Promise(() => {}),
};
type ProjectRoute = Exclude<Route, { name: "projects" }>;

let host: ReturnType<typeof mockHost>;

// A thread's pane asks the host for what it shows; these tests are about the page around it.
beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
  host = mockHost();
  host.respondWith(({ url }) => {
    if (url.endsWith("/messages")) return json({ messages: [] });
    if (url.endsWith("/activity")) return json({ turns: [] });
    if (url.endsWith("/status")) return json({ repos: [] });
    if (url.endsWith("/diff")) {
      return json({ defaultBranch: "main", files: [], perFileLineCap: 2000, summaryOnly: true });
    }
    return hostError(404, "NOT_FOUND", "not found");
  });
});
afterEach(() => {
  cleanup();
  host.restore();
});

const renderPage = (state: ProjectsState, route: ProjectRoute) => {
  const stub = stubLiveProjects(state);
  render(
    <ChatApiProvider value={silentHost}>
      <ProjectsProvider live={stub.live}>
        <ProjectPage route={route} />
      </ProjectsProvider>
    </ChatApiProvider>,
  );
  return stub;
};

const home: ProjectRoute = { name: "project", projectId: "p1" };
const project = makeProject({ id: "p1", name: "Checkout", goal: "Keep checkout fast" });

const threads = [
  makeThread({ id: "idle", projectId: "p1", title: "Tidy the docs", status: "idle" }),
  makeThread({
    id: "blocked",
    projectId: "p1",
    title: "Pick a database",
    status: "waiting-on-you",
  }),
  makeThread({
    id: "busy",
    projectId: "p1",
    title: "Fix the login redirect",
    status: "working",
    steps: [
      { label: "Reproduce", state: "done" },
      { label: "Fix", state: "active" },
    ],
    liveStatusLine: "Bisecting",
  }),
];

const titles = () =>
  screen
    .getAllByTestId("thread-card")
    .map((card) => within(card).getByTestId("thread-card-link").textContent);

describe("project home", () => {
  test("shows the project, what waits on the person, and every thread as a card, questions first", () => {
    renderPage(makeState([makeEntry(project, threads)]), home);

    expect(screen.getByTestId("project-title").textContent).toBe("Checkout");
    expect(screen.getByTestId("project-attention").textContent).toBe("1 thread is waiting on you.");
    expect(screen.getByTestId("project-tab-waiting").textContent).toBe("1");
    expect(titles()).toEqual(["Pick a database", "Fix the login redirect", "Tidy the docs"]);
    expect(screen.getByTestId("thread-count").textContent).toBe("3 threads");
  });

  test("groups the cards by status, so the question is set apart from the rest", () => {
    renderPage(makeState([makeEntry(project, threads)]), home);

    expect(
      screen.getAllByTestId("thread-group").map((group) => group.getAttribute("data-status")),
    ).toEqual(["waiting-on-you", "working", "idle"]);
    expect(
      screen.getByTestId("overview-counters").querySelector('[data-counter="waiting"]')
        ?.textContent,
    ).toContain("1");
  });

  test("a new thread on the stream appears as a card, and a finished one moves", () => {
    const stub = renderPage(
      makeState([makeEntry(project, [threads[2] as (typeof threads)[number]])]),
      home,
    );
    expect(titles()).toEqual(["Fix the login redirect"]);

    act(() => stub.set(makeState([makeEntry(project, threads)])));
    expect(titles()).toEqual(["Pick a database", "Fix the login redirect", "Tidy the docs"]);

    act(() =>
      stub.set(
        makeState([
          makeEntry(project, [
            ...threads.slice(0, 2),
            makeThread({
              id: "busy",
              projectId: "p1",
              title: "Fix the login redirect",
              status: "ready-for-review",
            }),
          ]),
        ]),
      ),
    );
    const busy = screen
      .getAllByTestId("thread-card")
      .find((card) => card.getAttribute("data-thread-id") === "busy");
    expect(busy?.getAttribute("data-status")).toBe("ready-for-review");
  });

  test("search narrows the threads by title, status line or question, and says when nothing matches", () => {
    renderPage(makeState([makeEntry(project, threads)]), home);
    const search = screen.getByTestId("thread-search");

    fireEvent.change(search, { target: { value: "bisect" } });
    expect(titles()).toEqual(["Fix the login redirect"]);
    expect(screen.getByTestId("thread-count").textContent).toBe("1 of 3");

    fireEvent.change(search, { target: { value: "which database" } });
    expect(titles()).toEqual(["Pick a database"]);

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByTestId("threads-no-match").textContent).toContain("zzz");
    expect(screen.queryByTestId("thread-groups")).toBeNull();
  });

  test("a project with no threads points at the coordinator", () => {
    renderPage(makeState([makeEntry(project, [])]), home);

    expect(screen.getByTestId("threads-empty")).toBeTruthy();
    expect(screen.getByTestId("project-attention").textContent).toBe("Nothing is waiting on you.");
    fireEvent.click(screen.getByTestId("threads-empty-chat"));
    expect(window.location.pathname).toBe("/projects/p1/chat");
  });

  test("while the threads load, it says so", () => {
    renderPage(makeState([makeEntry(project, [], { threadsLoaded: false })]), home);
    expect(screen.getByTestId("threads-loading")).toBeTruthy();
    expect(screen.queryByTestId("project-attention")).toBeNull();
  });

  test("shows a paused or archived project as such", () => {
    renderPage(makeState([makeEntry(makeProject({ id: "p1", status: "paused" }), [])]), home);
    expect(screen.getByTestId("project-status-tag").textContent).toBe("paused");
  });

  test("reports the stream: live, then reconnecting", () => {
    const stub = renderPage(makeState([makeEntry(project, threads, { connection: "live" })]), home);
    expect(screen.getByTestId("project-stream-state").textContent).toContain("Live");

    act(() => stub.set(makeState([makeEntry(project, threads, { connection: "reconnecting" })])));
    expect(screen.getByTestId("project-stream-state").getAttribute("data-state")).toBe(
      "reconnecting",
    );
    expect(screen.getByTestId("project-stream-state").textContent).toContain("Reconnecting");

    act(() => stub.set(makeState([makeEntry(project, threads, { connection: "idle" })])));
    expect(screen.queryByTestId("project-stream-state")).toBeNull();
  });
});

describe("project screens", () => {
  const state = () => makeState([makeEntry(project, threads)]);

  test("the tabs move between the threads and the coordinator, and mark where you are", () => {
    renderPage(state(), { name: "coordinator", projectId: "p1" });

    expect(screen.getByTestId("project-tab-coordinator").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("project-tab-threads").getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("coordinator-chat-pane")).toBeTruthy();
    expect(screen.queryByTestId("thread-groups")).toBeNull();

    fireEvent.click(screen.getByTestId("project-tab-threads"));
    expect(window.location.pathname).toBe("/projects/p1");
    fireEvent.click(screen.getByTestId("project-tab-settings"));
    expect(window.location.pathname).toBe("/projects/p1/settings");
  });

  test("a thread route shows that thread's pane under the Threads tab", async () => {
    renderPage(state(), { name: "thread", projectId: "p1", threadId: "blocked" });
    await act(async () => {});

    expect(screen.getByTestId("thread-pane").textContent).toContain("Pick a database");
    expect(screen.getByTestId("project-tab-threads").getAttribute("aria-current")).toBe("page");
  });

  test("a thread that does not exist says so", () => {
    renderPage(state(), { name: "thread", projectId: "p1", threadId: "gone" });
    expect(screen.getByTestId("thread-not-found")).toBeTruthy();
  });

  test("the settings route shows the settings pane, on the section the address names", () => {
    renderPage(state(), { name: "project-settings", projectId: "p1", section: "general" });
    const pane = screen.getByTestId("project-settings-pane");
    expect(pane.getAttribute("data-section")).toBe("general");
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Checkout");
    expect(screen.getByTestId("project-tab-settings").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("project-settings-nav-general").getAttribute("aria-current")).toBe(
      "page",
    );
  });
});

describe("the coordinator tab", () => {
  const answered: ChatApi = {
    ...silentHost,
    listMessages: async () => [
      { id: "u1", projectId: "p1", threadId: null, createdAt: at(1), role: "user", text: "Hi" },
      reply("a1", 2),
      reply("a2", 10),
    ],
  };

  const renderWith = async (route: ProjectRoute, seenAt: string) => {
    window.localStorage.setItem("aop:coordinator-seen:v1", JSON.stringify({ p1: seenAt }));
    const stub = stubLiveProjects(makeState([makeEntry(project, threads)]));
    await act(async () => {
      render(
        <ChatApiProvider value={answered}>
          <ProjectsProvider live={stub.live}>
            <ProjectPage route={route} />
          </ProjectsProvider>
        </ChatApiProvider>,
      );
    });
  };

  test("counts the replies this device has not looked at, while another tab is open", async () => {
    await renderWith(home, at(2));

    expect(screen.getByTestId("project-tab-coordinator-unseen").textContent).toBe("1");
  });

  test("shows no count on the tab that is open, and none when everything was seen", async () => {
    await renderWith({ name: "coordinator", projectId: "p1" }, at(2));
    expect(screen.queryByTestId("project-tab-coordinator-unseen")).toBeNull();
    cleanup();

    await renderWith(home, at(10));
    expect(screen.queryByTestId("project-tab-coordinator-unseen")).toBeNull();
  });
});

describe("a project that is not there", () => {
  test("is a loading state until the list arrives, then a plain not-found", () => {
    const stub = renderPage(makeState([], { phase: "loading" }), home);
    expect(screen.getByTestId("project-loading")).toBeTruthy();

    act(() => stub.set(makeState([])));
    expect(screen.getByTestId("project-not-found")).toBeTruthy();
    fireEvent.click(screen.getByText("Back to all projects"));
    expect(window.location.pathname).toBe("/");
  });
});
