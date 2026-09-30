import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  makeEntry,
  makeProject,
  makeState,
  makeThread,
  stubLiveProjects,
} from "../projects/test-utils";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { SidebarProvider } = await import("../ui/sidebar");
const { ProjectsProvider } = await import("../projects/ProjectsProvider");
const { ProjectsSidebar } = await import("./ProjectsSidebar");
const { getDialogs, resetDialogs } = await import("./dialog-store");
type ProjectsState = ReturnType<typeof makeState>;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
  globalThis.fetch = mock(async () =>
    Response.json({ error: "not here" }, { status: 404 }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  resetDialogs();
  globalThis.fetch = originalFetch;
});

const renderSidebar = (
  state: ProjectsState,
  handlers = { onOpenCommand: () => {}, onNewProject: () => {} },
) => {
  const stub = stubLiveProjects(state);
  render(
    <ProjectsProvider live={stub.live}>
      <SidebarProvider>
        <ProjectsSidebar {...handlers} />
      </SidebarProvider>
    </ProjectsProvider>,
  );
  return stub;
};

const rows = () => screen.getAllByTestId("project-row");
const rowFor = (name: string) => {
  const row = rows().find((candidate) => candidate.textContent?.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

describe("ProjectsSidebar attention", () => {
  test("shows how many threads wait on the person, ahead of running work", () => {
    renderSidebar(
      makeState([
        makeEntry(makeProject({ id: "a", name: "Checkout" }), [
          makeThread({ id: "t1", projectId: "a", status: "waiting-on-you" }),
          makeThread({ id: "t2", projectId: "a", status: "waiting-on-you" }),
          makeThread({ id: "t3", projectId: "a", status: "working" }),
        ]),
        makeEntry(makeProject({ id: "b", name: "Storefront" }), [
          makeThread({ id: "t4", projectId: "b", status: "working" }),
        ]),
        makeEntry(makeProject({ id: "c", name: "Docs" }), [
          makeThread({ id: "t5", projectId: "c", status: "idle" }),
        ]),
      ]),
    );

    const checkout = rowFor("Checkout");
    expect(checkout.getAttribute("data-attention")).toBe("waiting");
    expect(within(checkout).getByTestId("project-attention-waiting").textContent).toBe("2");
    expect(within(checkout).queryByTestId("project-attention-working")).toBeNull();

    const storefront = rowFor("Storefront");
    expect(storefront.getAttribute("data-attention")).toBe("working");
    expect(within(storefront).getByTestId("project-attention-working")).toBeTruthy();

    const docs = rowFor("Docs");
    expect(docs.getAttribute("data-attention")).toBe("none");
    expect(within(docs).queryByTestId("project-attention-waiting")).toBeNull();
  });

  test("a project whose threads have not arrived shows no attention rather than a false all-clear", () => {
    renderSidebar(
      makeState([
        makeEntry(makeProject({ id: "a", name: "Checkout" }), [], { threadsLoaded: false }),
      ]),
    );
    expect(rowFor("Checkout").getAttribute("data-attention")).toBe("none");
  });

  test("marks a paused project", () => {
    renderSidebar(makeState([makeEntry(makeProject({ name: "Checkout", status: "paused" }))]));
    expect(within(rowFor("Checkout")).getByTestId("project-paused")).toBeTruthy();
  });

  test("a change on the stream updates the row without remounting the sidebar", () => {
    const project = makeProject({ id: "a", name: "Checkout" });
    const stub = renderSidebar(makeState([makeEntry(project, [])]));
    expect(rowFor("Checkout").getAttribute("data-attention")).toBe("none");

    act(() =>
      stub.set(
        makeState([makeEntry(project, [makeThread({ projectId: "a", status: "waiting-on-you" })])]),
      ),
    );
    expect(rowFor("Checkout").getAttribute("data-attention")).toBe("waiting");
  });
});

describe("ProjectsSidebar groups and routing", () => {
  const state = () =>
    makeState([
      makeEntry(makeProject({ id: "a", name: "Alpha", updatedAt: "2026-09-29T12:00:00.000Z" })),
      makeEntry(makeProject({ id: "b", name: "Bravo", updatedAt: "2026-09-29T11:00:00.000Z" })),
      makeEntry(makeProject({ id: "c", name: "Charlie", status: "archived" })),
    ]);

  test("lists projects newest first and folds archived ones away", () => {
    renderSidebar(state());

    const active = screen.getByTestId("sidebar-active");
    expect(
      within(active)
        .getAllByTestId("project-row")
        .map((row) => row.getAttribute("data-project-id")),
    ).toEqual(["a", "b"]);
    const archived = screen.getByTestId("sidebar-archived");
    expect(archived.textContent).toContain("Archived · 1");
  });

  test("pinned projects lead in their own group", () => {
    window.localStorage.setItem("aop:pinned-projects:v1", JSON.stringify(["b"]));
    renderSidebar(state());

    expect(within(screen.getByTestId("sidebar-pinned")).getAllByTestId("project-row")).toHaveLength(
      1,
    );
    expect(within(screen.getByTestId("sidebar-pinned")).getByText("Bravo")).toBeTruthy();
    expect(within(screen.getByTestId("sidebar-active")).queryByText("Bravo")).toBeNull();
  });

  test("the open project's row is marked, and a row opens its project", () => {
    window.history.pushState({}, "", "/projects/b");
    renderSidebar(state());

    expect(rowFor("Bravo").getAttribute("data-active")).toBe("true");
    expect(rowFor("Alpha").getAttribute("data-active")).toBe("false");

    fireEvent.click(within(rowFor("Alpha")).getByText("Alpha"));
    expect(window.location.pathname).toBe("/projects/a");
  });

  test("All projects goes home", () => {
    window.history.pushState({}, "", "/projects/a");
    renderSidebar(state());

    fireEvent.click(screen.getByTestId("sidebar-all-projects"));
    expect(window.location.pathname).toBe("/");
  });
});

describe("ProjectsSidebar chrome", () => {
  test("New project calls back, and so does the empty state's own button", () => {
    const onNewProject = mock(() => {});
    renderSidebar(makeState([]), { onOpenCommand: () => {}, onNewProject });

    fireEvent.click(screen.getByTestId("sidebar-new-project"));
    fireEvent.click(within(screen.getByTestId("sidebar-empty")).getByText("New project"));

    expect(onNewProject).toHaveBeenCalledTimes(2);
    expect(screen.getByText("No projects yet")).toBeTruthy();
  });

  test("search opens the palette", () => {
    const onOpenCommand = mock(() => {});
    renderSidebar(makeState([]), { onOpenCommand, onNewProject: () => {} });

    fireEvent.click(screen.getByTestId("sidebar-search"));
    expect(onOpenCommand).toHaveBeenCalled();
  });

  test("a failed first load says so instead of showing an empty list", () => {
    renderSidebar(makeState([], { phase: "error", error: "Failed to fetch", reachable: false }));

    expect(screen.getByTestId("sidebar-error").textContent).toContain("Failed to fetch");
    expect(screen.queryByTestId("sidebar-empty")).toBeNull();
  });

  test("the footer reports the connection to the host", () => {
    renderSidebar(makeState([makeEntry(makeProject(), [], { connection: "reconnecting" })]));
    const status = screen.getByTestId("connection-status");
    expect(status.getAttribute("data-state")).toBe("reconnecting");
    expect(status.textContent).toContain("Reconnecting");
  });

  test("Settings opens the settings dialog", () => {
    renderSidebar(makeState([]));
    fireEvent.click(screen.getByTestId("sidebar-settings"));
    expect(getDialogs().settings.open).toBe(true);
  });
});
