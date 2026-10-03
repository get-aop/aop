import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakeLiveHost, makeLease, makeSession } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { LiveView } = await import("./LiveView");
const { LiveViewNotice } = await import("./LiveViewNotice");
const { resetLiveViewForTests, refreshLiveView, pickLiveViewThread } = await import(
  "./live-view-store"
);

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetLiveViewForTests();
  localStorage.removeItem("aop:live-view:corner");
});

afterEach(() => {
  cleanup();
  resetLiveViewForTests();
  globalThis.fetch = originalFetch;
});

const renderView = () =>
  render(
    <div className="@container">
      <LiveViewNotice />
      <LiveView />
    </div>,
  );

const popup = () => waitFor(() => screen.getByTestId("live-view-popup"));
const has = (testId: string) => screen.queryByTestId(testId) !== null;

/** A drag on the popup's header from its centre to `to`, released there. */
const drag = (element: HTMLElement, to: { x: number; y: number }) => {
  const header = screen.getByTestId("live-view-header");
  const from = {
    x: Number.parseFloat(element.style.left) + 10,
    y: Number.parseFloat(element.style.top) + 10,
  };
  fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(header, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(header, { pointerId: 1, clientX: to.x, clientY: to.y });
};

describe("when the live view shows", () => {
  test("a paired device sees the thread that uses CUA, linked, with a live dot", async () => {
    installFakeLiveHost({ viewer: "device", mode: "remote" });
    renderView();

    const view = await popup();
    const link = screen.getByTestId("live-view-thread-link");
    expect(link.textContent).toBe("Check the login page");
    expect(link.getAttribute("href")).toBe("/projects/prj_1/threads/thr_1");
    expect(has("live-view-dot")).toBe(true);
    expect(view.dataset.corner).toBe("top-right");
  });

  test("the person at the host sees nothing by default (remote viewers only)", async () => {
    const host = installFakeLiveHost({ viewer: "owner", mode: "remote" });
    renderView();
    await waitFor(() => expect(host.statusCalls).toBeGreaterThan(0));
    await act(() => refreshLiveView());

    expect(has("live-view-popup")).toBe(false);
    expect(host.frameCalls).toBe(0);
  });

  test("Always shows it at the host too; Off shows it to no one", async () => {
    const host = installFakeLiveHost({ viewer: "owner", mode: "always" });
    renderView();
    await popup();

    host.mode = "off";
    host.viewer = "device";
    await act(() => refreshLiveView());
    expect(has("live-view-popup")).toBe(false);
  });

  test("goes away once no thread uses CUA", async () => {
    const host = installFakeLiveHost();
    renderView();
    await popup();

    host.sessions = [];
    await act(() => refreshLiveView());
    expect(has("live-view-popup")).toBe(false);
  });
});

describe("the popup", () => {
  test("shows the host's frames", async () => {
    installFakeLiveHost();
    renderView();
    await popup();

    const image = await waitFor(() => screen.getByTestId("live-view-image"));
    expect(image.getAttribute("src")?.startsWith("blob:")).toBe(true);
  });

  test("says why when the host cannot capture", async () => {
    installFakeLiveHost({
      frame: {
        status: 503,
        code: "LIVE_VIEW_UNAVAILABLE",
        error: "Live view unavailable: ffmpeg is not installed on the host.",
      },
    });
    renderView();
    await popup();

    const error = await waitFor(() => screen.getByTestId("live-view-error"));
    expect(error.textContent).toBe("Live view unavailable: ffmpeg is not installed on the host.");
  });

  test("drags anywhere, snaps to the nearest corner when let go, and remembers it", async () => {
    installFakeLiveHost();
    renderView();
    const view = await popup();

    drag(view, { x: 40, y: window.innerHeight - 40 });

    expect(view.dataset.corner).toBe("bottom-left");
    expect(localStorage.getItem("aop:live-view:corner")).toBe("bottom-left");
    expect(Number.parseFloat(view.style.left)).toBe(12);

    cleanup();
    renderView();
    expect((await popup()).dataset.corner).toBe("bottom-left");
  });

  test("a click on the picture opens it full screen; Escape brings the popup back", async () => {
    installFakeLiveHost();
    renderView();
    await popup();

    // With the pointer captured, a browser aims the release at the popup, not the picture.
    const body = screen.getByTestId("live-view-body");
    fireEvent.pointerDown(body, { button: 0, pointerId: 1, clientX: 900, clientY: 150 });
    fireEvent.pointerUp(screen.getByTestId("live-view-popup"), {
      pointerId: 1,
      clientX: 901,
      clientY: 150,
    });

    await waitFor(() => screen.getByTestId("live-view-fullscreen"));
    expect(has("live-view-popup")).toBe(false);

    fireEvent.keyDown(window, { key: "Escape" });
    await popup();
    expect(has("live-view-fullscreen")).toBe(false);
  });

  test("the full screen's Picture in picture button turns it back into the popup", async () => {
    installFakeLiveHost();
    renderView();
    await popup();
    // A keyboard press of the picture's button: a click with no pointer detail.
    fireEvent.click(screen.getByTestId("live-view-body"), { detail: 0 });
    await waitFor(() => screen.getByTestId("live-view-fullscreen"));

    fireEvent.click(screen.getByTestId("live-view-exit-fullscreen"));
    await popup();
  });

  test("a press on the header's buttons neither drags nor opens full screen", async () => {
    installFakeLiveHost();
    renderView();
    const view = await popup();

    const minimize = screen.getByTestId("live-view-minimize");
    fireEvent.pointerDown(minimize, { button: 0, pointerId: 1, clientX: 900, clientY: 80 });
    fireEvent.pointerMove(minimize, { pointerId: 1, clientX: 100, clientY: 600 });
    fireEvent.pointerUp(minimize, { pointerId: 1, clientX: 100, clientY: 600 });
    fireEvent.click(minimize);

    expect(view.dataset.corner).toBe("top-right");
    expect(has("live-view-fullscreen")).toBe(false);
    expect(has("live-view-body")).toBe(false);
  });

  test("minimizes to its header and opens again", async () => {
    installFakeLiveHost();
    renderView();
    await popup();

    fireEvent.click(screen.getByTestId("live-view-minimize"));
    expect(has("live-view-body")).toBe(false);
    expect(has("live-view-header")).toBe(true);

    fireEvent.click(screen.getByTestId("live-view-minimize"));
    expect(has("live-view-body")).toBe(true);
  });

  test("closing hides it for the session; the top bar's Live view button brings it back", async () => {
    installFakeLiveHost();
    renderView();
    await popup();
    expect(has("live-view-show")).toBe(false);

    fireEvent.click(screen.getByTestId("live-view-close"));
    expect(has("live-view-popup")).toBe(false);
    expect(sessionStorage.getItem("aop:live-view:closed")).toBe("1");

    fireEvent.click(screen.getByTestId("live-view-show"));
    await popup();
    expect(has("live-view-show")).toBe(false);
  });
});

describe("several threads using CUA", () => {
  test("shows the most recently active one, with a switcher to pick another", async () => {
    installFakeLiveHost({
      sessions: [
        makeSession({ threadId: "thr_2", title: "Fix the footer" }),
        makeSession({ threadId: "thr_1", title: "Check the login page" }),
      ],
    });
    renderView();
    await popup();

    expect(screen.getByTestId("live-view-thread-link").textContent).toBe("Fix the footer");
    expect(screen.getByTestId("live-view-switcher").textContent).toBe("2");

    act(() => pickLiveViewThread("thr_1"));
    expect(screen.getByTestId("live-view-thread-link").textContent).toBe("Check the login page");
  });

  test("one thread has no switcher", async () => {
    installFakeLiveHost();
    renderView();
    await popup();
    expect(has("live-view-switcher")).toBe(false);
  });
});

describe("the computer-use lease in the header", () => {
  const login = { threadId: "thr_1", title: "Check the login page" };
  const footer = { threadId: "thr_2", title: "Fix the footer" };
  const docs = { threadId: "thr_3", title: "Screenshot the docs" };

  test("the popup counts who waits behind the thread on screen, the whole line in its tooltip", async () => {
    installFakeLiveHost({ lease: makeLease(login, [footer, docs]) });
    renderView();
    await popup();

    const lease = screen.getByTestId("live-view-lease");
    expect(lease.textContent).toBe("2 waiting");
    expect(lease.getAttribute("title")).toBe("Computer use: Check the login page · 2 waiting");
    expect(lease.dataset.holder).toBe("thr_1");
  });

  test("the popup says nothing while the thread on screen holds it and no one waits", async () => {
    installFakeLiveHost({ lease: makeLease(login) });
    renderView();
    await popup();

    expect(has("live-view-lease")).toBe(false);
  });

  test("names a holder other than the thread on screen, and someone outside AOP's lease", async () => {
    const host = installFakeLiveHost({ lease: makeLease(footer, [login]) });
    renderView();
    await popup();
    expect(screen.getByTestId("live-view-lease").textContent).toBe(
      "Computer use: Fix the footer · 1 waiting",
    );

    host.lease = { ...makeLease(null), holder: { kind: "external", owner: "thr_x", since: null } };
    await act(() => refreshLiveView());
    expect(screen.getByTestId("live-view-lease").textContent).toBe(
      "Computer use: thr_x (outside AOP's lease)",
    );
  });

  test("full screen always names the holder", async () => {
    installFakeLiveHost({ lease: makeLease(login, [footer]) });
    renderView();
    await popup();
    fireEvent.click(screen.getByTestId("live-view-body"), { detail: 0 });
    await waitFor(() => screen.getByTestId("live-view-fullscreen"));

    expect(screen.getByTestId("live-view-lease").textContent).toBe(
      "Computer use: Check the login page · 1 waiting",
    );
  });
});
