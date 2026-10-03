import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import type { ProjectsState } from "../projects-state";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "../test-utils";
import { mockEmptyThreadHost, silentChatHost } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { ProjectPage } = await import("../ProjectPage");
const { ChatApiProvider } = await import("../chat/chat-api");
const { navigate, useRoute } = await import("../../shell/router");

let host: ReturnType<typeof mockEmptyThreadHost>;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/p1");
  host = mockEmptyThreadHost();
});
afterEach(() => {
  cleanup();
  host.restore();
});

const project = makeProject({ id: "p1", name: "Checkout" });
const blocked = makeThread({
  id: "blocked",
  projectId: "p1",
  title: "Pick a database",
  status: "waiting-on-you",
});
const busy = makeThread({ id: "busy", projectId: "p1", title: "Fix the login", status: "working" });
const stateWith = (...threads: ReturnType<typeof makeThread>[]): ProjectsState =>
  makeState([makeEntry(project, threads)]);

// The page as the app mounts it: the route follows the address, so a click that navigates moves it.
const Routed = () => {
  const route = useRoute();
  return route.name === "projects" || route.name === "inbox" ? null : <ProjectPage route={route} />;
};

const mount = (state: ProjectsState = stateWith(blocked, busy)) => {
  const stub = stubLiveProjects(state);
  render(
    <ChatApiProvider value={silentChatHost}>
      <ProjectsProvider live={stub.live}>
        <Routed />
      </ProjectsProvider>
    </ChatApiProvider>,
  );
  return stub;
};

/** Pretends the pane holder is `width` pixels wide, which is what picks side by side, overlay or one pane. */
const holderWidth = (width: number) =>
  spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 800,
    top: 0,
    left: 0,
    right: width,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

const panel = () => screen.queryByTestId("threads-panel");
const chatColumn = () => screen.getByTestId("chat-column");

describe("the panel toggle", () => {
  test("is labelled Overview and leads the settings link and menu, right after the project switcher and its + button", () => {
    mount();
    const toggle = screen.getByTestId("panel-toggle");
    const group = screen.getByTestId("project-topbar-actions");

    expect(toggle.textContent).toBe("Overview");
    expect(Array.from(group.children).map((child) => child.getAttribute("data-testid"))).toEqual([
      "panel-toggle",
      "project-settings-link",
      "project-header-menu",
    ]);
    const nav = screen.getByTestId("shell-nav");
    expect(group.previousElementSibling === nav).toBe(true);
    expect(nav.lastElementChild?.getAttribute("data-testid")).toBe("new-project-button");
  });

  test("closes the panel and opens it again, and this browser remembers which", async () => {
    mount();
    expect(panel()).toBeTruthy();
    expect(screen.getByTestId("panel-toggle").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByTestId("panel-toggle"));
    expect(panel()).toBeNull();
    expect(screen.getByTestId("panel-toggle").getAttribute("aria-pressed")).toBe("false");

    cleanup();
    mount();
    expect(panel()).toBeNull();

    fireEvent.click(screen.getByTestId("panel-toggle"));
    expect(panel()).toBeTruthy();
    cleanup();
    mount();
    expect(panel()).toBeTruthy();
  });

  test("each project keeps its own panel: closing it in one leaves the other open", () => {
    const second = makeProject({ id: "p2", name: "Payments" });
    mount(makeState([makeEntry(project, [blocked]), makeEntry(second, [])]));
    expect(panel()).toBeTruthy();

    fireEvent.click(screen.getByTestId("panel-toggle"));
    expect(panel()).toBeNull();

    act(() => navigate("/projects/p2"));
    expect(panel()).toBeTruthy();
    fireEvent.click(screen.getByTestId("panel-toggle"));
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByTestId("panel-toggle"));
    expect(panel()).toBeTruthy();

    act(() => navigate("/projects/p1"));
    expect(panel()).toBeNull();
    act(() => navigate("/projects/p2"));
    expect(panel()).toBeTruthy();
  });

  test("the close button in the panel does the same", () => {
    mount();

    fireEvent.click(screen.getByTestId("panel-close"));

    expect(panel()).toBeNull();
    expect(screen.getByTestId("coordinator-chat-pane")).toBeTruthy();
  });

  test("storage that throws leaves the panel working, just not remembered", () => {
    const get = spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      mount();
      expect(panel()).toBeTruthy();
      fireEvent.click(screen.getByTestId("panel-toggle"));
      expect(panel()).toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  test("shows a dot while a thread waits on the person, and the Threads tab a count", () => {
    const stub = mount();
    expect(screen.getByTestId("panel-toggle-dot")).toBeTruthy();
    expect(screen.getByTestId("project-tab-waiting").textContent).toBe("1");

    act(() => stub.set(stateWith(busy)));
    expect(screen.queryByTestId("panel-toggle-dot")).toBeNull();
    expect(screen.queryByTestId("project-tab-waiting")).toBeNull();
  });
});

describe("opening a thread", () => {
  test("a thread link opens it in the panel even when the panel was closed, chat kept", async () => {
    mount();
    fireEvent.click(screen.getByTestId("panel-close"));
    expect(panel()).toBeNull();

    act(() => navigate("/projects/p1/threads/blocked"));
    await act(async () => {});

    expect(panel()).toBeTruthy();
    expect(screen.getByTestId("thread-pane").getAttribute("data-thread-id")).toBe("blocked");
    expect(screen.getByTestId("coordinator-chat-pane")).toBeTruthy();
  });

  test("closing the panel on a thread takes the thread off the address", async () => {
    window.history.pushState({}, "", "/projects/p1/threads/busy");
    mount();
    await act(async () => {});
    expect(screen.getByTestId("thread-pane")).toBeTruthy();

    fireEvent.click(screen.getByTestId("panel-close"));

    expect(window.location.pathname).toBe("/projects/p1");
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByTestId("panel-toggle"));
    expect(screen.getByTestId("thread-groups")).toBeTruthy();
  });

  test("the breadcrumb goes back to the overview, and the browser's back button returns to the thread", async () => {
    mount();
    fireEvent.click(screen.getAllByTestId("thread-card-link")[0] as HTMLElement);
    await act(async () => {});
    expect(window.location.pathname).toBe("/projects/p1/threads/blocked");

    fireEvent.click(screen.getByTestId("thread-back"));
    expect(window.location.pathname).toBe("/projects/p1");
    expect(screen.getByTestId("thread-groups")).toBeTruthy();

    act(() => {
      window.history.back();
    });
    await act(async () => {});
    expect(screen.queryByTestId("thread-pane")?.getAttribute("data-thread-id") ?? null).toBe(
      window.location.pathname.endsWith("/blocked") ? "blocked" : null,
    );
  });

  test("the old chat address shows the project screen", () => {
    window.history.pushState({}, "", "/projects/p1/chat");
    mount();

    expect(window.location.pathname).toBe("/projects/p1");
    expect(screen.getByTestId("coordinator-chat-pane")).toBeTruthy();
    expect(screen.getByTestId("thread-groups")).toBeTruthy();
  });
});

describe("the panel beside the top bar", () => {
  const layoutEl = () => screen.getByTestId("project-layout");
  const topBar = () => screen.getByTestId("project-topbar");
  const besideTopBar = () => layoutEl().getAttribute("data-panel-beside-top-bar");

  test("runs from the top of the screen, and the top bar spans only the chat", () => {
    mount();
    expect(besideTopBar()).toBe("true");
    expect(topBar().className).toContain("col-start-1");
    expect(topBar().className).not.toContain("col-span-full");
    expect(panel()?.className).toContain("row-span-full");
    expect(screen.getByTestId("panel-divider").className).toContain("row-span-full");
    expect(layoutEl().style.gridTemplateColumns).toBe(
      "minmax(0, 1fr) auto min(520px, calc(100% - 340px))",
    );
  });

  test("a thread open in the panel keeps it beside the top bar", async () => {
    mount();
    act(() => navigate("/projects/p1/threads/busy"));
    await act(async () => {});

    expect(screen.getByTestId("thread-header")).toBeTruthy();
    expect(besideTopBar()).toBe("true");
    expect(panel()?.className).toContain("row-span-full");
  });

  test("closed, the top bar spans the screen again", () => {
    mount();
    fireEvent.click(screen.getByTestId("panel-close"));

    expect(besideTopBar()).toBe("false");
    expect(topBar().className).toContain("col-span-full");
    expect(layoutEl().style.gridTemplateColumns).toBe("minmax(0, 1fr) auto auto");
  });

  test("expanded, the panel sits under a top bar that spans the screen", () => {
    mount();
    fireEvent.click(screen.getByTestId("panel-expand"));

    expect(besideTopBar()).toBe("false");
    expect(topBar().className).toContain("col-span-full");
    expect(panel()?.className).toContain("row-start-2");
    expect(panel()?.className).toContain("col-span-full");
    expect(layoutEl().style.gridTemplateColumns).toBe("minmax(0, 1fr) auto auto");
  });

  test("laid over the chat it reaches the top too, and expanded it stays under the top bar", () => {
    const rect = holderWidth(700);
    try {
      mount();
      fireEvent.click(screen.getByTestId("panel-toggle"));
      expect(besideTopBar()).toBe("true");
      expect(panel()?.className).toContain("row-span-full");

      fireEvent.click(screen.getByTestId("panel-expand"));
      expect(besideTopBar()).toBe("false");
      expect(panel()?.className).toContain("row-start-2");
      expect(topBar().className).toContain("col-span-full");
    } finally {
      rect.mockRestore();
    }
  });

  test("on a phone the panel replaces the chat under the top bar", () => {
    const rect = holderWidth(390);
    try {
      mount();
      fireEvent.click(screen.getByTestId("panel-toggle"));

      expect(besideTopBar()).toBe("false");
      expect(panel()?.className).toContain("row-start-2");
      expect(topBar().className).toContain("col-span-full");
    } finally {
      rect.mockRestore();
    }
  });
});

describe("expand", () => {
  test("gives the panel the chat's room, keeps the chat alive, and restores it", () => {
    mount();
    expect(screen.getByTestId("panel-divider")).toBeTruthy();

    fireEvent.click(screen.getByTestId("panel-expand"));
    expect(panel()?.getAttribute("data-expanded")).toBe("true");
    expect(chatColumn().className).toContain("hidden");
    expect(screen.getByTestId("coordinator-chat-pane")).toBeTruthy();
    expect(screen.queryByTestId("panel-divider")).toBeNull();

    fireEvent.click(screen.getByTestId("panel-expand"));
    expect(panel()?.getAttribute("data-expanded")).toBe("false");
    expect(chatColumn().className).not.toContain("hidden");
  });

  test("+ › New thread gives the chat its room back and puts the cursor in its composer", async () => {
    mount();
    fireEvent.click(screen.getByTestId("panel-expand"));

    fireEvent.pointerDown(screen.getByTestId("panel-add"), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByTestId("panel-new-thread"));
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));

    expect(chatColumn().className).not.toContain("hidden");
    expect(document.activeElement).toBe(screen.getByTestId("composer-input"));
  });
});

describe("the divider", () => {
  test("the arrow keys resize the panel, and the width is remembered", () => {
    mount();
    const before = Number(screen.getByTestId("panel-divider").getAttribute("aria-valuenow"));

    fireEvent.keyDown(screen.getByTestId("panel-divider"), { key: "ArrowLeft" });
    const after = Number(screen.getByTestId("panel-divider").getAttribute("aria-valuenow"));
    expect(after).toBeGreaterThan(before);
    expect(screen.getByTestId("project-layout").style.gridTemplateColumns).toContain(
      `min(${after}px,`,
    );

    cleanup();
    mount();
    expect(screen.getByTestId("panel-divider").getAttribute("aria-valuenow")).toBe(`${after}`);
  });

  test("never makes the panel narrower than its minimum", () => {
    mount();

    for (let press = 0; press < 40; press++) {
      fireEvent.keyDown(screen.getByTestId("panel-divider"), { key: "ArrowRight" });
    }

    expect(screen.getByTestId("panel-divider").getAttribute("aria-valuenow")).toBe("360");
  });
});

describe("dragging", () => {
  test("the divider follows the pointer until it is let go, and the width is remembered", () => {
    const rect = holderWidth(1184);
    try {
      mount();
      const divider = () => screen.getByTestId("panel-divider");

      fireEvent.pointerDown(divider(), { button: 0, clientX: 664 });
      expect(divider().getAttribute("data-dragging")).toBe("true");
      fireEvent.pointerMove(window, { clientX: 500 });
      expect(divider().getAttribute("aria-valuenow")).toBe("684");
      fireEvent.pointerUp(window);
      expect(divider().getAttribute("data-dragging")).toBe("false");

      fireEvent.pointerMove(window, { clientX: 300 });
      expect(divider().getAttribute("aria-valuenow")).toBe("684");
      expect(JSON.parse(window.localStorage.getItem("aop:threads-panel:v2:p1") ?? "{}").width).toBe(
        684,
      );
    } finally {
      rect.mockRestore();
    }
  });

  test("never leaves the chat less than its minimum room", () => {
    const rect = holderWidth(1000);
    try {
      mount();

      fireEvent.pointerDown(screen.getByTestId("panel-divider"), { button: 0, clientX: 480 });
      fireEvent.pointerMove(window, { clientX: 10 });

      expect(screen.getByTestId("panel-divider").getAttribute("aria-valuenow")).toBe("660");
    } finally {
      rect.mockRestore();
    }
  });
});

describe("the status filter", () => {
  test("switches a status off and back on in the overview", () => {
    mount();
    const groups = () =>
      screen.getAllByTestId("thread-group").map((group) => group.getAttribute("data-status"));
    expect(groups()).toContain("working");

    fireEvent.pointerDown(screen.getByTestId("panel-filter"), { button: 0, ctrlKey: false });
    const working = screen
      .getAllByTestId("panel-filter-option")
      .find((option) => option.getAttribute("data-status") === "working") as HTMLElement;
    fireEvent.click(working);

    expect(groups()).not.toContain("working");
    expect(screen.getByTestId("panel-filter-dot")).toBeTruthy();
    expect(screen.getByTestId("thread-count").textContent).toBe("1 of 2");

    fireEvent.click(screen.getByTestId("thread-filters-clear"));
    expect(groups()).toContain("working");
    expect(screen.queryByTestId("panel-filter-dot")).toBeNull();
  });
});

describe("narrow windows", () => {
  test("a window that fits both panes shows them side by side", () => {
    const rect = holderWidth(1184);
    try {
      mount();
      expect(screen.getByTestId("project-layout").getAttribute("data-mode")).toBe("side");
      expect(panel()?.getAttribute("data-mode")).toBe("side");
    } finally {
      rect.mockRestore();
    }
  });

  test("a medium window lays the panel over the chat, closed until asked for", () => {
    const rect = holderWidth(700);
    try {
      mount();
      expect(screen.getByTestId("project-layout").getAttribute("data-mode")).toBe("overlay");
      expect(panel()).toBeNull();

      fireEvent.click(screen.getByTestId("panel-toggle"));
      expect(panel()?.getAttribute("data-mode")).toBe("overlay");
      expect(chatColumn().className).not.toContain("hidden");
      expect(screen.queryByTestId("panel-divider")).toBeNull();
    } finally {
      rect.mockRestore();
    }
  });

  test("a phone shows one pane at a time, switched from the top bar", () => {
    const rect = holderWidth(390);
    try {
      mount();
      expect(screen.getByTestId("project-layout").getAttribute("data-mode")).toBe("single");
      expect(panel()).toBeNull();
      expect(chatColumn().className).not.toContain("hidden");

      fireEvent.click(screen.getByTestId("panel-toggle"));
      expect(panel()).toBeTruthy();
      expect(chatColumn().className).toContain("hidden");
      expect(screen.queryByTestId("panel-expand")).toBeNull();

      fireEvent.click(screen.getByTestId("panel-toggle"));
      expect(panel()).toBeNull();
      expect(chatColumn().className).not.toContain("hidden");
    } finally {
      rect.mockRestore();
    }
  });

  test("a phone that opens a thread shows it, and the desktop's remembered state is left alone", async () => {
    const rect = holderWidth(390);
    try {
      mount();
      act(() => navigate("/projects/p1/threads/busy"));
      await act(async () => {});

      expect(screen.getByTestId("thread-pane")).toBeTruthy();
      expect(chatColumn().className).toContain("hidden");
      expect(JSON.parse(window.localStorage.getItem("aop:threads-panel:v2:p1") ?? "{}").open).toBe(
        true,
      );
    } finally {
      rect.mockRestore();
    }
  });
});
