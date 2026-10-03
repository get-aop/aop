import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  makeEntry,
  makeProject,
  makeState,
  makeThread,
  stubLiveProjects,
} from "../projects/test-utils";
import { setupDashboardDom } from "../test/setup-dom";
import { makeUpdateStatus } from "../updates/test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ProjectsProvider } = await import("../projects/ProjectsProvider");
const { AppShell } = await import("./AppShell");
const { AppTopBar } = await import("./AppTopBar");
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
  test("has no sidebar: the screen gets the whole width, and brings its own top bar", () => {
    renderShell();

    expect(screen.getByTestId("screen")).toBeTruthy();
    expect(screen.queryByTestId("projects-sidebar")).toBeNull();
    expect(screen.queryByTestId("sidebar-toggle")).toBeNull();
    expect(document.querySelector('[data-slot="sidebar-wrapper"]') === null).toBe(true);
    expect(screen.getByTestId("screen").parentElement?.tagName).toBe("MAIN");
  });

  test("is one screen tall, so a long screen scrolls inside it instead of growing the page", () => {
    renderShell();

    expect(screen.getByTestId("app-shell").classList.contains("h-svh")).toBe(true);
    const inset = screen.getByTestId("screen").parentElement;
    expect(inset?.classList.contains("min-h-0")).toBe(true);
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

describe("AppShell project switcher", () => {
  const renderWithTopBar = () => {
    const stub = stubLiveProjects(state());
    render(
      <ProjectsProvider live={stub.live}>
        <AppShell>
          <AppTopBar />
        </AppShell>
      </ProjectsProvider>,
    );
  };

  test("⌘K opens it from anywhere, even while typing, and ⌘K again closes it", async () => {
    renderWithTopBar();
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "k", metaKey: true });
    input.remove();

    expect(getDialogs().switcher).toBe(true);
    expect(await screen.findByTestId("project-switcher-popover")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(getDialogs().switcher).toBe(false);
    await waitFor(() =>
      expect(screen.queryByTestId("project-switcher-popover") === null).toBe(true),
    );
  });

  test("closes when the page moves, so the next screen does not open with it", async () => {
    renderWithTopBar();
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(getDialogs().switcher).toBe(true);

    act(() => {
      window.history.pushState({}, "", "/projects/b");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(getDialogs().switcher).toBe(false);
  });

  test("its tooltip names the shortcut", () => {
    renderWithTopBar();
    expect(screen.getByTestId("project-switcher").getAttribute("title")).toContain("⌘K");
    expect(screen.getByTestId("project-switcher").getAttribute("aria-keyshortcuts")).toBe("Meta+K");
  });
});

describe("AppShell in the desktop app", () => {
  test("the app menu's Settings… opens the AOP settings", () => {
    let listener: (() => void) | null = null;
    const host = window as Window & { aopDesktop?: unknown };
    host.aopDesktop = {
      onOpenSettings: (next: () => void) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    };
    try {
      renderShell();
      expect(listener === null).toBe(false);
      act(() => listener?.());
      expect(getDialogs().settings).toEqual({ open: true, section: "general" });
      cleanup();
      expect(listener === null).toBe(true);
    } finally {
      delete host.aopDesktop;
    }
  });
});

describe("AppShell keyboard and dialogs", () => {
  test("⌘, opens the AOP settings, even while typing", () => {
    renderShell();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: ",", metaKey: true });
    input.remove();
    expect(getDialogs().settings).toEqual({ open: true, section: "general" });
  });

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
    for (const section of [
      "general",
      "host",
      "updates",
      "repositories",
      "runtimes",
      "computer-use",
      "about",
    ]) {
      expect(within(dialog).getByTestId(`settings-nav-${section}`)).toBeTruthy();
    }
    expect(within(dialog).queryByText("Workflows")).toBeNull();
    expect(within(dialog).queryByTestId("settings-nav-exec-hosts")).toBeNull();
  });

  describe("the Host section", () => {
    const answerAs = (principal: object, canUpdate: boolean) => {
      const answers: Record<string, unknown> = {
        "/api/auth/me": principal,
        "/api/auth/devices": {
          devices: [
            { id: "d1", name: "Laptop", createdAt: "2026-09-29T10:00:00.000Z", lastSeenAt: null },
          ],
        },
        "/api/updates": makeUpdateStatus({
          canUpdate,
          owner: (principal as { kind: string }).kind === "owner",
        }),
      };
      globalThis.fetch = mock(async (input: string | URL | Request) =>
        Response.json(answers[String(input)] ?? { settings: [] }),
      ) as unknown as typeof fetch;
    };

    test("is listed for everyone and holds the paired devices", async () => {
      answerAs({ kind: "owner" }, true);
      renderShell();
      act(() => openSettingsDialog("general"));
      const dialog = await screen.findByTestId("settings-dialog");

      fireEvent.click(await within(dialog).findByTestId("settings-nav-host"));
      expect(await within(dialog).findByTestId("section-host")).toBeTruthy();
      expect(await within(dialog).findByTestId("section-devices")).toBeTruthy();
      expect(getDialogs().settings.section).toBe("host");
      expect(await within(dialog).findByTestId("device-revoke")).toBeTruthy();
    });

    test("shows a paired device the list read-only, with the reason, once the owner narrowed it", async () => {
      answerAs(
        {
          kind: "device",
          device: {
            id: "d2",
            name: "Phone",
            createdAt: "2026-09-29T10:00:00.000Z",
            lastSeenAt: null,
          },
        },
        false,
      );
      renderShell();
      act(() => openSettingsDialog("host"));
      const dialog = await screen.findByTestId("settings-dialog");

      expect(await within(dialog).findByTestId("devices-readonly")).toBeTruthy();
      expect(within(dialog).queryByTestId("device-revoke")).toBeNull();
    });
  });

  test("Settings switches sections", async () => {
    renderShell();
    act(() => openSettingsDialog("general"));
    const dialog = await screen.findByTestId("settings-dialog");

    fireEvent.click(within(dialog).getByTestId("settings-nav-about"));
    expect(getDialogs().settings.section).toBe("about");
  });
});
