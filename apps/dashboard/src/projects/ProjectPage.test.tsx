import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { mockEmptyThreadHost, silentChatHost } from "./layout/test-utils";
import type { ProjectsState } from "./projects-state";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { ProjectsProvider } = await import("./ProjectsProvider");
const { ProjectPage } = await import("./ProjectPage");
const { ChatApiProvider } = await import("./chat/chat-api");
const { PROJECT_SETTINGS_SECTIONS, projectSettingsPath } = await import("../shell/router");
type Route = import("../shell/router").Route;

type ProjectRoute = Exclude<Route, { name: "projects" | "inbox" }>;

let host: ReturnType<typeof mockEmptyThreadHost>;

// A thread's pane asks the host for what it shows; these tests are about the page around it.
beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
  host = mockEmptyThreadHost();
});
afterEach(() => {
  cleanup();
  host.restore();
});

const renderPage = (state: ProjectsState, route: ProjectRoute) => {
  const stub = stubLiveProjects(state);
  render(
    <ChatApiProvider value={silentChatHost}>
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
    ).toEqual(["waiting-on-you", "working", "idle", "resolved"]);
    expect(screen.getByTestId("project-attention").getAttribute("data-waiting")).toBe("1");
    expect(screen.queryByTestId("overview-counters")).toBeNull();
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
    fireEvent.click(screen.getByTestId("panel-search"));
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

  test("a project with no threads says nothing waits, and + takes the person to the coordinator's composer", async () => {
    renderPage(makeState([makeEntry(project, [])]), home);

    expect(screen.getByTestId("project-attention").textContent).toBe("Nothing is waiting on you.");
    expect(screen.getAllByTestId("thread-group")).toHaveLength(2);
    fireEvent.pointerDown(screen.getByTestId("panel-add"), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByTestId("panel-new-thread"));
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    expect(document.activeElement).toBe(screen.getByTestId("composer-input"));
    expect(window.location.pathname).toBe("/");
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

  test("the project route shows the chat and the panel on its overview, side by side", () => {
    renderPage(state(), home);

    expect(screen.getByTestId("coordinator-chat-pane")).toBeTruthy();
    expect(screen.getByTestId("threads-panel")).toBeTruthy();
    expect(screen.getByTestId("panel-tab-threads").getAttribute("aria-selected")).toBe("true");
    // The tabs, then "+" straight after them.
    expect(screen.getByTestId("panel-tab-threads").parentElement?.nextElementSibling).toBe(
      screen.getByTestId("panel-add"),
    );
    expect(screen.getByTestId("thread-groups")).toBeTruthy();
    expect(screen.queryByTestId("thread-pane")).toBeNull();
    expect(screen.queryByTestId("project-tab-coordinator")).toBeNull();
  });

  test("a thread route keeps the chat and puts that thread in the panel, under a breadcrumb", async () => {
    renderPage(state(), { name: "thread", projectId: "p1", threadId: "blocked" });
    await act(async () => {});

    expect(screen.getByTestId("coordinator-chat-pane")).toBeTruthy();
    expect(screen.getByTestId("thread-pane").textContent).toContain("Pick a database");
    expect(screen.queryByTestId("thread-groups")).toBeNull();
    expect(screen.getByTestId("thread-back").textContent).toBe("Threads");
    expect(screen.getByTestId("thread-title").textContent).toBe("Pick a database");

    fireEvent.click(screen.getByTestId("thread-back"));
    expect(window.location.pathname).toBe("/projects/p1");
  });

  test("a thread that does not exist says so", () => {
    renderPage(state(), { name: "thread", projectId: "p1", threadId: "gone" });
    expect(screen.getByTestId("thread-not-found")).toBeTruthy();
  });

  test("the settings route opens the settings in a dialog over the project, on the section the address names", async () => {
    renderPage(state(), { name: "project-settings", projectId: "p1", section: "memory" });
    await act(async () => {});
    const dialog = screen.getByTestId("project-settings-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(screen.getByTestId("project-settings-pane").getAttribute("data-section")).toBe("memory");
    expect(screen.getByTestId("project-settings-title").textContent).toBe("Memory");
    expect(screen.getByTestId("project-settings-link").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("project-settings-nav-memory").getAttribute("aria-current")).toBe(
      "page",
    );
    // The project screen stays underneath.
    expect(screen.getByTestId("coordinator-chat-pane")).toBeTruthy();
    expect(screen.getByTestId("panel-toggle")).toBeTruthy();
  });

  test("× and Escape close the settings back to the screen they opened over, and the chat keeps its draft", async () => {
    const stub = stubLiveProjects(state());
    const page = (route: ProjectRoute) => (
      <ChatApiProvider value={silentChatHost}>
        <ProjectsProvider live={stub.live}>
          <ProjectPage route={route} />
        </ProjectsProvider>
      </ChatApiProvider>
    );
    const thread: ProjectRoute = { name: "thread", projectId: "p1", threadId: "blocked" };
    const settings: ProjectRoute = {
      name: "project-settings",
      projectId: "p1",
      section: "general",
    };
    const view = render(page(thread));
    await act(async () => {});
    const chat = within(screen.getByTestId("coordinator-chat-pane"));
    const composer = chat.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "half a thought" } });

    view.rerender(page(settings));
    await act(async () => {});
    fireEvent.click(screen.getByTestId("project-settings-close"));
    expect(window.location.pathname).toBe("/projects/p1/threads/blocked");

    view.rerender(page(thread));
    expect(screen.queryByTestId("project-settings-dialog")).toBeNull();
    expect(chat.getByTestId("composer-input")).toBe(composer);
    expect(composer.value).toBe("half a thought");

    view.rerender(page(settings));
    await act(async () => {});
    fireEvent.keyDown(screen.getByTestId("project-settings-dialog"), { key: "Escape" });
    expect(window.location.pathname).toBe("/projects/p1/threads/blocked");
  });

  test("on a phone only the current section keeps its name in the nav; the others are named icons in a row that scrolls sideways", async () => {
    renderPage(state(), { name: "project-settings", projectId: "p1", section: "environment" });
    await act(async () => {});

    const nav = screen.getByRole("navigation", { name: "Project settings" });
    expect(nav.className).toContain("overflow-x-auto");
    for (const id of PROJECT_SETTINGS_SECTIONS) {
      const tab = screen.getByTestId(`project-settings-nav-${id}`);
      const label = within(tab).getByTestId("project-settings-nav-label");
      if (id === "environment") {
        expect(tab.getAttribute("aria-label")).toBeNull();
        expect(label.className).not.toContain("max-md:hidden");
      } else {
        expect(tab.getAttribute("aria-label")).toBe(label.textContent);
        expect(tab.getAttribute("title")).toBe(label.textContent);
        expect(label.className).toContain("max-md:hidden");
      }
    }
  });

  test("the nav lists every section in its groups, each with a heading and a line about it", async () => {
    renderPage(state(), { name: "project-settings", projectId: "p1", section: "threads" });
    await act(async () => {});

    const links = within(screen.getByRole("navigation", { name: "Project settings" })).getAllByRole(
      "link",
    );
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      PROJECT_SETTINGS_SECTIONS.map((id) => projectSettingsPath("p1", id)),
    );
    expect(screen.getByTestId("project-settings-title").textContent).toBe("Threads & permissions");
    expect(screen.getByTestId("project-settings-description").textContent).toContain(
      "What threads may do on this host",
    );
    expect(screen.getByTestId("settings-thread-access")).toBeTruthy();
  });

  test("arrow keys, Home and End move between the sections in the nav", async () => {
    renderPage(state(), { name: "project-settings", projectId: "p1", section: "general" });
    await act(async () => {});
    const nav = screen.getByRole("navigation", { name: "Project settings" });
    const tab = (id: string) => screen.getByTestId(`project-settings-nav-${id}`);

    tab("general").focus();
    fireEvent.keyDown(nav, { key: "ArrowDown" });
    expect(document.activeElement).toBe(tab("models"));
    fireEvent.keyDown(nav, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("threads"));
    fireEvent.keyDown(nav, { key: "ArrowUp" });
    expect(document.activeElement).toBe(tab("models"));
    fireEvent.keyDown(nav, { key: "End" });
    expect(document.activeElement).toBe(tab("advanced"));
    fireEvent.keyDown(nav, { key: "ArrowDown" });
    expect(document.activeElement).toBe(tab("general"));
    fireEvent.keyDown(nav, { key: "Home" });
    expect(document.activeElement).toBe(tab("general"));
  });

  test("a deep link to the settings closes to the project's home", async () => {
    renderPage(state(), { name: "project-settings", projectId: "p1", section: "general" });
    await act(async () => {});
    fireEvent.click(screen.getByTestId("project-settings-close"));
    expect(window.location.pathname).toBe("/projects/p1");
  });

  test("the settings button in the top bar opens the settings", () => {
    renderPage(state(), home);

    fireEvent.click(screen.getByTestId("project-settings-link"));

    expect(window.location.pathname).toBe("/projects/p1/settings");
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
