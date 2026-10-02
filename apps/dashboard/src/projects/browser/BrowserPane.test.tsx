import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { mockEmptyThreadHost, silentChatHost } from "../layout/test-utils";
import type { ProjectsState } from "../projects-state";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";
import { installFakeBrowserBridge, readyWebview } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { ProjectPage } = await import("../ProjectPage");
const { ChatApiProvider } = await import("../chat/chat-api");
const { SidebarProvider } = await import("@/ui/sidebar");
const { useRoute } = await import("../../shell/router");
const { browserTabsKey } = await import("./use-browser-tabs");

let host: ReturnType<typeof mockEmptyThreadHost>;
let bridge: ReturnType<typeof installFakeBrowserBridge> | null;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/p1");
  host = mockEmptyThreadHost();
  bridge = installFakeBrowserBridge();
});
afterEach(() => {
  cleanup();
  host.restore();
  bridge?.uninstall();
});

const state: ProjectsState = makeState([
  makeEntry(makeProject({ id: "p1", name: "Checkout" }), []),
]);

const Routed = () => {
  const route = useRoute();
  return route.name === "projects" ? null : <ProjectPage route={route} />;
};

const mount = () => {
  const stub = stubLiveProjects(state);
  render(
    <SidebarProvider>
      <ChatApiProvider value={silentChatHost}>
        <ProjectsProvider live={stub.live}>
          <Routed />
        </ProjectsProvider>
      </ChatApiProvider>
    </SidebarProvider>,
  );
};

const settle = () => act(async () => {});
const toggle = () => screen.getByTestId("browser-toggle");
const column = () => screen.queryByTestId("browser-column");
const chatColumn = () => screen.getByTestId("chat-column");
const address = () => screen.getByTestId("browser-address") as HTMLInputElement;
const go = async (text: string) => {
  fireEvent.change(address(), { target: { value: text } });
  fireEvent.submit(address().closest("form") as HTMLFormElement);
  await settle();
};
const webviews = () => [...document.querySelectorAll("webview")];

describe("the AOP Browser in the chat's place", () => {
  test("opens from the top bar over a chat that keeps its draft, and the breadcrumb brings the chat back", async () => {
    mount();
    expect(column()).toBeNull();
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "half a thought" } });

    fireEvent.click(toggle());
    await settle();
    expect(window.location.pathname).toBe("/projects/p1/browser");
    expect(column()?.getAttribute("data-shown")).toBe("true");
    expect(chatColumn().className).toContain("hidden");
    expect(screen.getByTestId("browser-start-page")).toBeTruthy();
    expect(bridge?.calls).toContainEqual(["setActive", true]);

    fireEvent.click(screen.getByTestId("browser-pane-coordinator"));
    await settle();
    expect(window.location.pathname).toBe("/projects/p1");
    expect(chatColumn().className).not.toContain("hidden");
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe(
      "half a thought",
    );
    // Parked, not gone: its pages live on while the chat is in front.
    expect(column()?.getAttribute("data-shown")).toBe("false");
    expect(column()?.hasAttribute("inert")).toBe(true);
    expect(bridge?.calls.at(-1)).toEqual(["setActive", false]);
  });

  test("an address loads in a sandboxed page on the browser's own partition", async () => {
    window.history.pushState({}, "", "/projects/p1/browser");
    mount();
    await go("localhost:5173");

    const [page] = webviews();
    expect(page?.getAttribute("src")).toBe("http://localhost:5173/");
    expect(page?.getAttribute("partition")).toBe("persist:aop-browser");
    expect(page?.getAttribute("preload")).toBeNull();
    expect(screen.queryByTestId("browser-start-page")).toBeNull();

    let guest: ReturnType<typeof readyWebview> = { send: () => true, loaded: [] };
    act(() => {
      guest = readyWebview(page as Element, 41);
    });
    act(() => {
      guest.send("did-navigate", { url: "http://localhost:5173/login" });
      guest.send("page-title-updated", { title: "Sign in" });
    });
    expect(address().value).toBe("http://localhost:5173/login");
    expect(screen.getByTestId("browser-tab").textContent).toContain("Sign in");

    await go("how to center a div");
    expect(guest.loaded).toEqual(["https://www.google.com/search?q=how%20to%20center%20a%20div"]);
  });

  test("shortcuts from the app open, cycle and close tabs; ⌘L focuses the address bar", async () => {
    window.history.pushState({}, "", "/projects/p1/browser");
    mount();
    await go("example.com");

    act(() => bridge?.emit({ kind: "shortcut", shortcut: "new-tab", webContentsId: null }));
    await settle();
    expect(screen.getAllByTestId("browser-tab")).toHaveLength(2);
    expect(screen.getByTestId("browser-start-page")).toBeTruthy();

    act(() => bridge?.emit({ kind: "shortcut", shortcut: "next-tab", webContentsId: null }));
    await settle();
    expect(address().value).toBe("https://example.com/");

    (document.activeElement as HTMLElement | null)?.blur();
    act(() => bridge?.emit({ kind: "shortcut", shortcut: "focus-address", webContentsId: null }));
    expect(document.activeElement).toBe(address());

    act(() => bridge?.emit({ kind: "shortcut", shortcut: "close-tab", webContentsId: null }));
    await settle();
    expect(screen.getAllByTestId("browser-tab")).toHaveLength(1);
    expect(webviews()).toHaveLength(0);
  });

  test("a page's question waits under the toolbar, and the answer goes to the app", async () => {
    window.history.pushState({}, "", "/projects/p1/browser");
    mount();
    await go("https://meet.example/");
    act(() => void readyWebview(webviews()[0] as Element, 7));

    act(() =>
      bridge?.emit({
        kind: "prompt",
        prompt: { id: "q1", webContentsId: 7, origin: "https://meet.example", ask: "camera" },
      }),
    );
    expect(screen.getByTestId("browser-prompt").textContent).toContain(
      "meet.example wants to use your camera",
    );
    fireEvent.click(screen.getByTestId("browser-prompt-deny"));
    expect(bridge?.calls).toContainEqual(["answerPrompt", "q1", false]);

    act(() => bridge?.emit({ kind: "prompt-closed", id: "q1" }));
    expect(screen.queryByTestId("browser-prompt")).toBeNull();
  });

  test("a download shows a button that lists it", async () => {
    window.history.pushState({}, "", "/projects/p1/browser");
    mount();
    expect(screen.queryByTestId("browser-downloads")).toBeNull();
    act(() =>
      bridge?.emit({
        kind: "download",
        download: {
          id: "d1",
          webContentsId: 7,
          filename: "report.pdf",
          state: "completed",
          receivedBytes: 2048,
          totalBytes: 2048,
        },
      }),
    );
    expect(screen.getByTestId("browser-downloads")).toBeTruthy();
  });

  test("a link opened from the app's menu opens the browser on it", async () => {
    mount();
    act(() =>
      bridge?.emit({ kind: "open-tab", url: "http://localhost:25490/", webContentsId: null }),
    );
    await settle();
    expect(window.location.pathname).toBe("/projects/p1/browser");
    expect(webviews()[0]?.getAttribute("src")).toBe("http://localhost:25490/");
  });

  test("remembers the project's tabs for next time", async () => {
    window.history.pushState({}, "", "/projects/p1/browser");
    mount();
    await go("example.com");
    const saved = JSON.parse(window.localStorage.getItem(browserTabsKey("p1")) ?? "null");
    expect(saved.tabs.map((tab: { url: string }) => tab.url)).toEqual(["https://example.com/"]);

    cleanup();
    mount();
    expect(address().value).toBe("https://example.com/");
  });

  test("a panel that covers the chat's column parks the page out of the window", async () => {
    window.history.pushState({}, "", "/projects/p1/browser");
    mount();
    expect(column()?.getAttribute("data-shown")).toBe("true");
    fireEvent.click(screen.getByTestId("panel-expand"));
    await settle();
    expect(column()?.getAttribute("data-shown")).toBe("false");
  });
});

describe("in a plain browser", () => {
  test("there is no button, and a browser address says where the AOP Browser lives", async () => {
    bridge?.uninstall();
    bridge = null;
    mount();
    expect(screen.queryByTestId("browser-toggle")).toBeNull();

    cleanup();
    window.history.pushState({}, "", "/projects/p1/browser");
    mount();
    expect(screen.getByTestId("browser-unavailable").textContent).toContain(
      "The AOP Browser is in the desktop app",
    );
    expect(webviews()).toHaveLength(0);
  });
});
