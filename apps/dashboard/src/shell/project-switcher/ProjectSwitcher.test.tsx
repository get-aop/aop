import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  makeEntry,
  makeProject,
  makeState,
  makeThread,
  stubLiveProjects,
} from "../../projects/test-utils";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ProjectsProvider } = await import("../../projects/ProjectsProvider");
const { ShellNav } = await import("../ShellNav");
const { getDialogs, resetDialogs, setProjectSwitcherOpen } = await import("../dialog-store");
type ProjectsState = ReturnType<typeof makeState>;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/a");
  globalThis.fetch = mock(async () =>
    Response.json({ error: "not here" }, { status: 404 }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  resetDialogs();
  globalThis.fetch = originalFetch;
});

const alpha = makeProject({ id: "a", name: "Alpha", updatedAt: "2026-09-29T12:00:00.000Z" });
const bravo = makeProject({ id: "b", name: "Bravo", updatedAt: "2026-09-29T11:00:00.000Z" });
const charlie = makeProject({ id: "c", name: "Charlie", updatedAt: "2026-09-29T10:00:00.000Z" });

/** Alpha is open; Bravo has two threads waiting on the person and Charlie one working. */
const busyState = () =>
  makeState([
    makeEntry(alpha, []),
    makeEntry(bravo, [
      makeThread({ id: "t1", projectId: "b", status: "waiting-on-you" }),
      makeThread({ id: "t2", projectId: "b", status: "waiting-on-you" }),
    ]),
    makeEntry(charlie, [makeThread({ id: "t3", projectId: "c", status: "working" })]),
  ]);

const renderNav = (state: ProjectsState = busyState(), currentId: string | null = "a") => {
  const stub = stubLiveProjects(state);
  render(
    <ProjectsProvider live={stub.live}>
      <ShellNav current={currentId ? (state.byId[currentId] ?? null) : null} />
    </ProjectsProvider>,
  );
  return stub;
};

const openSwitcher = async (): Promise<HTMLElement> => {
  fireEvent.click(screen.getByTestId("project-switcher"));
  return screen.findByTestId("project-switcher-popover");
};

const rowIds = (popover: HTMLElement) =>
  within(popover)
    .queryAllByTestId("switcher-project")
    .map((row) => row.getAttribute("data-project-id"));

const search = (popover: HTMLElement) =>
  within(popover).getByTestId("project-switcher-search") as HTMLInputElement;

const selectedValue = (popover: HTMLElement) =>
  popover.querySelector('[cmdk-item][data-selected="true"]')?.getAttribute("data-value");

describe("the chip", () => {
  test("names the open project", () => {
    renderNav();
    expect(screen.getByTestId("project-title").textContent).toBe("Alpha");
  });

  test("asks for a project where none is open", () => {
    renderNav(busyState(), null);
    expect(screen.getByTestId("project-title").textContent).toBe("Select a project");
  });

  test("carries a dot while another project waits on the person", () => {
    renderNav();
    expect(screen.getByTestId("project-switcher-dot")).toBeTruthy();
    expect(screen.getByTestId("project-switcher").getAttribute("aria-label")).toContain(
      "Another project is waiting on you",
    );
  });

  test("has no dot when only the open project waits", () => {
    renderNav(
      makeState([
        makeEntry(alpha, [makeThread({ projectId: "a", status: "waiting-on-you" })]),
        makeEntry(bravo, []),
      ]),
    );
    expect(screen.queryByTestId("project-switcher-dot") === null).toBe(true);
  });

  test("tags a paused project", () => {
    const paused = makeProject({ id: "a", name: "Alpha", status: "paused" });
    renderNav(makeState([makeEntry(paused)]));
    expect(screen.getByTestId("project-status-tag").textContent).toBe("paused");
  });
});

describe("the list", () => {
  test("opens on a click with the search focused, the open project checked", async () => {
    renderNav();
    const popover = await openSwitcher();

    expect(document.activeElement === search(popover)).toBe(true);
    expect(rowIds(popover)).toEqual(["a", "b", "c"]);
    const current = popover.querySelector('[data-current="true"]');
    expect(current?.getAttribute("data-project-id")).toBe("a");
    expect(current?.getAttribute("aria-current")).toBe("page");
    expect(within(popover).getAllByTestId("switcher-project-check")).toHaveLength(1);
  });

  test("shows what waits in each project: a count, else a working dot", async () => {
    renderNav();
    const popover = await openSwitcher();
    const row = (id: string) => popover.querySelector(`[data-project-id="${id}"]`) as HTMLElement;

    expect(row("b").getAttribute("data-attention")).toBe("waiting");
    expect(within(row("b")).getByTestId("project-attention-waiting").textContent).toBe("2");
    expect(row("c").getAttribute("data-attention")).toBe("working");
    expect(within(row("c")).getByTestId("project-attention-working")).toBeTruthy();
    expect(row("a").getAttribute("data-attention")).toBe("none");
  });

  test("a project whose threads have not arrived shows no attention rather than a false all-clear", async () => {
    renderNav(makeState([makeEntry(alpha, [], { threadsLoaded: false })]));
    const popover = await openSwitcher();
    expect(popover.querySelector('[data-project-id="a"]')?.getAttribute("data-attention")).toBe(
      "none",
    );
  });

  test("pinned projects lead, and archived ones come last", async () => {
    window.localStorage.setItem("aop:pinned-projects:v1", JSON.stringify(["c"]));
    const archived = makeProject({ id: "d", name: "Delta", status: "archived" });
    renderNav(makeState([makeEntry(alpha), makeEntry(charlie), makeEntry(archived)]));
    const popover = await openSwitcher();

    expect(rowIds(within(popover).getByTestId("project-switcher-pinned"))).toEqual(["c"]);
    expect(rowIds(within(popover).getByTestId("project-switcher-projects"))).toEqual(["a"]);
    expect(rowIds(within(popover).getByTestId("project-switcher-list"))).toEqual(["c", "a", "d"]);
    expect(rowIds(within(popover).getByTestId("project-switcher-archived"))).toEqual(["d"]);
  });

  test("typing filters it, and says when nothing matches", async () => {
    renderNav();
    const popover = await openSwitcher();

    fireEvent.change(search(popover), { target: { value: "bra" } });
    expect(rowIds(popover)).toEqual(["b"]);

    fireEvent.change(search(popover), { target: { value: "zulu" } });
    expect(rowIds(popover)).toEqual([]);
    expect(within(popover).getByTestId("project-switcher-no-match").textContent).toContain("zulu");
    // The actions stay, so New project is one Enter away.
    expect(within(popover).getByTestId("project-switcher-new-project")).toBeTruthy();
  });

  test("a click on another project switches to it and closes the list", async () => {
    renderNav();
    const popover = await openSwitcher();

    fireEvent.click(popover.querySelector('[data-project-id="b"]') as HTMLElement);
    expect(window.location.pathname).toBe("/projects/b");
    expect(getDialogs().switcher).toBe(false);
  });

  test("switching keeps the panel's tab", async () => {
    window.history.pushState({}, "", "/projects/a/library");
    renderNav();
    const popover = await openSwitcher();

    fireEvent.click(popover.querySelector('[data-project-id="c"]') as HTMLElement);
    expect(window.location.pathname).toBe("/projects/c/library");
  });

  test("picking the open project only closes the list", async () => {
    window.history.pushState({}, "", "/projects/a/threads/t9");
    renderNav();
    const popover = await openSwitcher();

    fireEvent.click(popover.querySelector('[data-project-id="a"]') as HTMLElement);
    expect(window.location.pathname).toBe("/projects/a/threads/t9");
    expect(getDialogs().switcher).toBe(false);
  });
});

describe("the keyboard", () => {
  test("arrows move through the projects and on to the actions, and Enter picks", async () => {
    renderNav();
    const popover = await openSwitcher();
    const input = search(popover);

    expect(selectedValue(popover)).toBe("a");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selectedValue(popover)).toBe("b");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selectedValue(popover)).toBe("action:new-project");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(selectedValue(popover)).toBe("b");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(window.location.pathname).toBe("/projects/b");
    expect(getDialogs().switcher).toBe(false);
  });

  test("typing selects the first match, so Enter opens it", async () => {
    renderNav();
    const popover = await openSwitcher();
    const input = search(popover);

    fireEvent.change(input, { target: { value: "char" } });
    await waitFor(() => expect(selectedValue(popover)).toBe("c"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(window.location.pathname).toBe("/projects/c");
  });

  test("Escape closes it without moving", async () => {
    renderNav();
    const popover = await openSwitcher();

    fireEvent.keyDown(search(popover), { key: "Escape" });
    expect(getDialogs().switcher).toBe(false);
    expect(window.location.pathname).toBe("/projects/a");
  });

  test("the search starts empty each time it opens", async () => {
    renderNav();
    let popover = await openSwitcher();
    fireEvent.change(search(popover), { target: { value: "bra" } });
    act(() => setProjectSwitcherOpen(false));
    await waitFor(() =>
      expect(screen.queryByTestId("project-switcher-popover") === null).toBe(true),
    );

    popover = await openSwitcher();
    expect(search(popover).value).toBe("");
    expect(rowIds(popover)).toEqual(["a", "b", "c"]);
  });
});

describe("the actions", () => {
  test("New project opens its dialog", async () => {
    renderNav();
    const popover = await openSwitcher();
    fireEvent.click(within(popover).getByTestId("project-switcher-new-project"));
    expect(getDialogs().newProject).toBe(true);
    expect(getDialogs().switcher).toBe(false);
  });

  test("All projects goes home", async () => {
    renderNav();
    const popover = await openSwitcher();
    fireEvent.click(within(popover).getByTestId("project-switcher-all-projects"));
    expect(window.location.pathname).toBe("/");
  });

  test("AOP settings opens the app's settings, with its shortcut shown", async () => {
    renderNav();
    const popover = await openSwitcher();
    const settings = within(popover).getByTestId("project-switcher-settings");
    expect(settings.textContent).toContain("⌘,");
    fireEvent.click(settings);
    expect(getDialogs().settings).toEqual({ open: true, section: "general" });
  });

  test("the last line reports the connection to the host and opens About", async () => {
    renderNav(makeState([makeEntry(alpha, [], { connection: "reconnecting" })]));
    const popover = await openSwitcher();
    const status = within(popover).getByTestId("connection-status");
    expect(status.getAttribute("data-state")).toBe("reconnecting");
    expect(status.textContent).toContain("Reconnecting");

    fireEvent.click(status);
    expect(getDialogs().settings).toEqual({ open: true, section: "about" });
  });

  test("with no projects yet it says so, and still offers New project", async () => {
    renderNav(makeState([]), null);
    const popover = await openSwitcher();
    expect(within(popover).getByTestId("project-switcher-empty").textContent).toContain(
      "No projects yet",
    );
    expect(within(popover).getByTestId("project-switcher-new-project")).toBeTruthy();
  });

  test("a failed first load says so instead of showing an empty list", async () => {
    renderNav(makeState([], { phase: "error", error: "Failed to fetch", reachable: false }), null);
    const popover = await openSwitcher();
    expect(within(popover).getByTestId("project-switcher-error").textContent).toContain(
      "Failed to fetch",
    );
    expect(within(popover).queryByTestId("project-switcher-empty") === null).toBe(true);
  });
});

describe("the + button", () => {
  test("opens the new-project dialog, and names its shortcut", () => {
    renderNav();
    const button = screen.getByTestId("new-project-button");
    expect(button.getAttribute("title")).toBe("New project (⌘N)");
    fireEvent.click(button);
    expect(getDialogs().newProject).toBe(true);
  });
});
