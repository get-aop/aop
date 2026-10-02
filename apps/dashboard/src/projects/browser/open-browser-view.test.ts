import { beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const {
  closeBrowserView,
  openBrowserView,
  subscribeQueuedUrls,
  takeQueuedUrls,
  toggleBrowserView,
} = await import("./open-browser-view");

beforeEach(() => window.history.pushState({}, "", "/projects/p1"));

describe("openBrowserView", () => {
  test("shows the browser in a new history entry, keeping an open thread beside it", () => {
    const before = window.history.length;
    openBrowserView({ projectId: "p1" });
    expect(window.location.pathname).toBe("/projects/p1/browser");
    expect(window.history.length).toBe(before + 1);

    window.history.pushState({}, "", "/projects/p1/threads/t1");
    openBrowserView({ projectId: "p1" });
    expect(window.location.pathname).toBe("/projects/p1/threads/t1/browser");
  });

  test("another project's thread is not this one's", () => {
    window.history.pushState({}, "", "/projects/p2/threads/t9");
    openBrowserView({ projectId: "p1" });
    expect(window.location.pathname).toBe("/projects/p1/browser");
  });

  test("queues an address for that project's browser, handed over once", () => {
    let heard = 0;
    const stop = subscribeQueuedUrls(() => {
      heard += 1;
    });
    openBrowserView({ projectId: "p1", url: "http://localhost:5173/" });
    openBrowserView({ projectId: "p1", url: "https://example.com/" });
    stop();
    expect(heard).toBe(2);
    expect(takeQueuedUrls("p2")).toEqual([]);
    expect(takeQueuedUrls("p1")).toEqual(["http://localhost:5173/", "https://example.com/"]);
    expect(takeQueuedUrls("p1")).toEqual([]);
  });
});

describe("closeBrowserView and toggleBrowserView", () => {
  test("give the chat its place back and leave the panel as it was", () => {
    window.history.pushState({}, "", "/projects/p1/threads/t1/browser");
    closeBrowserView();
    expect(window.location.pathname).toBe("/projects/p1/threads/t1");
  });

  test("closing does nothing where the browser is not shown", () => {
    const before = window.history.length;
    closeBrowserView();
    expect(window.history.length).toBe(before);
  });

  test("toggle shows the browser over the chat, and the chat over the browser", () => {
    toggleBrowserView("p1");
    expect(window.location.pathname).toBe("/projects/p1/browser");
    toggleBrowserView("p1");
    expect(window.location.pathname).toBe("/projects/p1");
  });
});
