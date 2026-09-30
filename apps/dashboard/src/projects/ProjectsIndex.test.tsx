import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { getDialogs, resetDialogs } = await import("../shell/dialog-store");
const { ProjectsProvider } = await import("./ProjectsProvider");
const { ProjectsIndex } = await import("./ProjectsIndex");
const { SidebarProvider } = await import("@/ui/sidebar");

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
});
afterEach(() => {
  cleanup();
  resetDialogs();
});

const renderIndex = (state: ReturnType<typeof makeState>) => {
  const stub = stubLiveProjects(state);
  render(
    <SidebarProvider>
      <ProjectsProvider live={stub.live}>
        <ProjectsIndex />
      </ProjectsProvider>
    </SidebarProvider>,
  );
};

const names = () =>
  screen
    .getAllByTestId("project-card")
    .map((card) => within(card).getByTestId("project-card-link").textContent);

const projects = () =>
  makeState([
    makeEntry(
      makeProject({
        id: "a",
        name: "Checkout",
        goal: "Keep checkout fast",
        updatedAt: "2026-09-29T12:00:00.000Z",
      }),
      [
        makeThread({ id: "t1", projectId: "a", status: "waiting-on-you" }),
        makeThread({ id: "t2", projectId: "a", status: "working" }),
      ],
    ),
    makeEntry(
      makeProject({ id: "b", name: "Storefront", goal: "", updatedAt: "2026-09-29T11:00:00.000Z" }),
      [],
    ),
    makeEntry(
      makeProject({
        id: "c",
        name: "Old site",
        goal: "",
        status: "archived",
        updatedAt: "2026-09-29T10:00:00.000Z",
      }),
    ),
  ]);

describe("ProjectsIndex", () => {
  test("a card per project: newest first, archived last, with goal and what needs attention", () => {
    renderIndex(projects());

    expect(names()).toEqual(["Checkout", "Storefront", "Old site"]);
    const checkout = screen.getAllByTestId("project-card")[0] as HTMLElement;
    expect(checkout.textContent).toContain("Keep checkout fast");
    expect(within(checkout).getByTestId("project-card-attention").textContent).toContain(
      "1 waiting on you",
    );
    expect(within(checkout).getByTestId("project-card-attention").textContent).toContain(
      "1 working",
    );
    expect(screen.getAllByTestId("project-card")[1]?.textContent).toContain("No goal set.");
    expect(screen.getAllByTestId("project-card")[2]?.getAttribute("data-status")).toBe("archived");
  });

  test("says how many threads wait on the person across every project", () => {
    renderIndex(projects());
    expect(screen.getByTestId("projects-attention").textContent).toBe(
      "1 thread is waiting on you.",
    );
  });

  test("a card opens its project", () => {
    renderIndex(projects());
    fireEvent.click(screen.getAllByTestId("project-card-link")[1] as HTMLElement);
    expect(window.location.pathname).toBe("/projects/b");
  });

  test("search filters by name or goal", () => {
    renderIndex(projects());
    const search = screen.getByTestId("project-search");

    fireEvent.change(search, { target: { value: "fast" } });
    expect(names()).toEqual(["Checkout"]);

    fireEvent.change(search, { target: { value: "storefront" } });
    expect(names()).toEqual(["Storefront"]);

    fireEvent.change(search, { target: { value: "nothing" } });
    expect(screen.queryByTestId("project-grid")).toBeNull();
    expect(screen.getByText(/No projects match/)).toBeTruthy();
  });

  test("New project opens the dialog", () => {
    renderIndex(projects());
    fireEvent.click(screen.getByTestId("projects-new"));
    expect(getDialogs().newProject).toBe(true);
  });

  test("with no projects it invites the first one", () => {
    renderIndex(makeState([]));

    expect(screen.getByTestId("projects-empty")).toBeTruthy();
    expect(screen.queryByTestId("project-search")).toBeNull();
    fireEvent.click(screen.getByTestId("projects-empty-new"));
    expect(getDialogs().newProject).toBe(true);
  });

  test("shows a failed load and a load in progress", () => {
    renderIndex(makeState([], { phase: "error", error: "Failed to fetch" }));
    expect(screen.getByTestId("projects-error").textContent).toContain("Failed to fetch");
    expect(screen.queryByTestId("projects-empty")).toBeNull();

    cleanup();
    renderIndex(makeState([], { phase: "loading" }));
    expect(screen.getByText("Loading projects…")).toBeTruthy();
    expect(screen.queryByTestId("projects-empty")).toBeNull();
  });
});
