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

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ProjectsProvider } = await import("../projects/ProjectsProvider");
const { AppShell } = await import("./AppShell");
const { getDialogs, openSettingsDialog, resetDialogs } = await import("./dialog-store");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
  globalThis.fetch = mock(async () => Response.json({ settings: [] })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  resetDialogs();
  globalThis.fetch = originalFetch;
});

const state = () =>
  makeState([
    makeEntry(makeProject({ id: "a", name: "Checkout" }), [
      makeThread({ projectId: "a", status: "waiting-on-you" }),
    ]),
    makeEntry(makeProject({ id: "b", name: "Storefront", status: "paused" })),
  ]);

const renderShell = () => {
  const stub = stubLiveProjects(state());
  render(
    <ProjectsProvider live={stub.live}>
      <AppShell>
        <div data-testid="screen" />
      </AppShell>
    </ProjectsProvider>,
  );
  return stub;
};

describe("AppShell", () => {
  test("the sidebar is the only chrome around the screen", () => {
    renderShell();

    expect(screen.getByTestId("projects-sidebar")).toBeTruthy();
    expect(screen.getByTestId("screen")).toBeTruthy();
    expect(screen.queryByTestId("app-rail")).toBeNull();
  });

  test("tells the live state which project is open, so it always has a stream", () => {
    window.history.pushState({}, "", "/projects/b/chat");
    const stub = renderShell();
    expect(stub.calls.setSelected.at(-1)).toBe("b");

    act(() => {
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(stub.calls.setSelected.at(-1)).toBeNull();
  });
});

describe("AppShell palette", () => {
  const openPalette = async (): Promise<HTMLElement> => {
    renderShell();
    fireEvent.click(screen.getByTestId("sidebar-search"));
    await screen.findByPlaceholderText("Find a project");
    return document.querySelector('[role="dialog"]') as HTMLElement;
  };

  test("finds projects by name and opens the chosen one", async () => {
    const palette = await openPalette();
    const items = within(palette).getAllByTestId("palette-project");
    expect(items.map((item) => item.textContent)).toEqual(["CCheckout", "SStorefrontpaused"]);

    fireEvent.click(items[1] as HTMLElement);
    expect(window.location.pathname).toBe("/projects/b");
    await waitFor(() => expect(screen.queryByPlaceholderText("Find a project")).toBeNull());
  });

  test("offers projects only: no actions, no sessions", async () => {
    const palette = await openPalette();
    expect(within(palette).getByText("Projects")).toBeTruthy();
    for (const label of ["Actions", "Sessions", "New session", "Workflows"]) {
      expect(within(palette).queryByText(label)).toBeNull();
    }
  });

  test("⌘K toggles it", async () => {
    renderShell();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await screen.findByPlaceholderText("Find a project");
  });
});

describe("AppShell keyboard and dialogs", () => {
  test("⌘N opens New project, except while typing", async () => {
    renderShell();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "n", metaKey: true });
    expect(getDialogs().newProject).toBe(false);
    input.remove();

    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    expect(getDialogs().newProject).toBe(true);
    expect(await screen.findByTestId("new-project-dialog")).toBeTruthy();
  });

  test("Settings lists the surviving sections and no Workflows section", async () => {
    renderShell();
    act(() => openSettingsDialog("general"));

    const dialog = await screen.findByTestId("settings-dialog");
    for (const section of ["general", "repositories", "runtimes", "exec-hosts", "about"]) {
      expect(within(dialog).getByTestId(`settings-nav-${section}`)).toBeTruthy();
    }
    expect(within(dialog).queryByText("Workflows")).toBeNull();
  });

  test("Settings switches sections", async () => {
    renderShell();
    act(() => openSettingsDialog("general"));
    const dialog = await screen.findByTestId("settings-dialog");

    fireEvent.click(within(dialog).getByTestId("settings-nav-about"));
    expect(getDialogs().settings.section).toBe("about");
  });
});
