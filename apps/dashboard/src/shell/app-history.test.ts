import { beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { canGoBack, canGoForward, pushEntry, replaceEntry } = await import("./app-history");

// Moves to an entry the way the back and forward buttons do: the browser restores its state.
const restore = (state: unknown) => {
  window.history.replaceState(state, "");
};

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("the app's own history", () => {
  test("the entry the app starts on has nothing behind it and nothing ahead", () => {
    expect(canGoBack()).toBe(false);
    expect(canGoForward()).toBe(false);
  });

  test("a page the app pushed has a page behind it, and still nothing ahead", () => {
    pushEntry("/projects/p1");

    expect(canGoBack()).toBe(true);
    expect(canGoForward()).toBe(false);
  });

  test("going back to an earlier entry leaves the ones after it ahead", () => {
    pushEntry("/projects/p1");
    const second = window.history.state;
    pushEntry("/projects/p2");

    restore(second);
    expect(canGoBack()).toBe(true);
    expect(canGoForward()).toBe(true);

    // The first entry was stamped when the app left it, so it knows it has entries ahead.
    restore({ aopHistoryIndex: 0 });
    expect(canGoBack()).toBe(false);
    expect(canGoForward()).toBe(true);
  });

  test("pushing from the middle ends what was ahead", () => {
    pushEntry("/projects/p1");
    pushEntry("/projects/p2");
    restore({ aopHistoryIndex: 1 });

    pushEntry("/projects/p3");

    expect(canGoForward()).toBe(false);
    expect(canGoBack()).toBe(true);
  });

  test("replacing an entry keeps its place", () => {
    pushEntry("/projects/p1");
    replaceEntry("/projects/p2");

    expect(canGoBack()).toBe(true);
    expect(canGoForward()).toBe(false);
    expect(window.location.pathname).toBe("/projects/p2");
  });

  test("an entry the app did not stamp is a fresh start, whatever storage remembers", () => {
    pushEntry("/projects/p1");
    pushEntry("/projects/p2");
    restore(null);

    expect(canGoBack()).toBe(false);
    expect(canGoForward()).toBe(false);
  });
});
