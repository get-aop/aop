import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { MessageScroller } from "./message-scroller";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");

const OriginalResizeObserver = globalThis.ResizeObserver;
let resized: (() => void)[] = [];

afterEach(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
  resized = [];
  cleanup();
});

/** A scroller whose sizes the test sets, and whose ResizeObserver the test fires. */
const mountScroller = (followKey = 0) => {
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resized.push(() => callback([], this as unknown as ResizeObserver));
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  const edges: boolean[] = [];
  const scrollCalls: unknown[] = [];
  const view = (key: number) => (
    <MessageScroller data-testid="scroller" followKey={key} onEdgeChange={(at) => edges.push(at)}>
      <div>Live response</div>
    </MessageScroller>
  );
  const { rerender } = render(view(followKey));
  const scroller = screen.getByTestId("scroller");
  let height = 240;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, get: () => height },
    scrollTo: { configurable: true, value: (options: unknown) => scrollCalls.push(options) },
  });
  // A ResizeObserver reports once when it starts observing.
  for (const fire of resized) fire();
  scroller.scrollTop = 140;
  fireEvent.scroll(scroller);
  return {
    scroller,
    edges,
    scrollCalls,
    grow: (to: number) => {
      height = to;
      for (const fire of resized) fire();
    },
    setHeight: (to: number) => {
      height = to;
    },
    rerenderSame: () => rerender(view(followKey)),
    refollow: (key: number) => rerender(view(key)),
  };
};

describe("MessageScroller", () => {
  test("while at the end, growth keeps the end in view by setting scrollTop, never a smooth scroll", () => {
    const { scroller, grow, scrollCalls } = mountScroller();

    grow(400);

    expect(scroller.scrollTop).toBe(400);
    expect(scrollCalls).toEqual([]);
    expect(scroller.style.overflowAnchor).toBe("none");
  });

  test("while at the end, a re-render with more content is pinned before it paints, observer or not", () => {
    const { scroller, setHeight, rerenderSame } = mountScroller();

    setHeight(380);
    rerenderSame();

    expect(scroller.scrollTop).toBe(380);
  });

  test("scrolling up stops following, and the browser keeps what the person reads in place", () => {
    const { scroller, grow, edges } = mountScroller();

    scroller.scrollTop = 120;
    fireEvent.scroll(scroller);
    grow(400);

    expect(scroller.scrollTop).toBe(120);
    expect(edges).toEqual([false]);
    expect(scroller.style.overflowAnchor).toBe("auto");
  });

  test("a wheel turned up stops following at once, before any scroll event", () => {
    const { scroller, setHeight, rerenderSame, edges } = mountScroller();

    fireEvent.wheel(scroller, { deltaY: -40 });
    setHeight(400);
    rerenderSame();

    expect(edges).toEqual([false]);
    expect(scroller.scrollTop).toBe(140);
  });

  test("scrolling back near the end follows again", () => {
    const { scroller, grow, edges } = mountScroller();
    scroller.scrollTop = 20;
    fireEvent.scroll(scroller);

    scroller.scrollTop = 110;
    fireEvent.scroll(scroller);
    grow(500);

    expect(edges).toEqual([false, true]);
    expect(scroller.scrollTop).toBe(500);
  });

  test("a new followKey (the person sent something) goes to the end and follows", () => {
    const { scroller, grow, refollow, edges } = mountScroller();
    scroller.scrollTop = 20;
    fireEvent.scroll(scroller);

    grow(600);
    refollow(1);

    expect(scroller.scrollTop).toBe(600);
    expect(edges).toEqual([false, true]);
  });

  test("older history that loads above the top of the view keeps the message that was there", () => {
    const { scroller, grow } = mountScroller();
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);

    grow(540);

    expect(scroller.scrollTop).toBe(300);
  });

  test("hidden and shown again, it is back where the person left it, not at the end", () => {
    const { scroller, grow } = mountScroller();
    scroller.scrollTop = 20;
    fireEvent.scroll(scroller);

    // display: none: no size, and the browser reads (and reports) scrollTop 0.
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 0 });
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    grow(0);
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    grow(400);

    expect(scroller.scrollTop).toBe(20);
  });

  test("hidden while following the end, it shows the end again", () => {
    const { scroller, grow } = mountScroller();

    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 0 });
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    grow(0);
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
    grow(400);

    expect(scroller.scrollTop).toBe(400);
  });
});

describe("MessageScroller top edge", () => {
  test("fades text out under the pane header instead of cutting its letters", () => {
    render(
      <MessageScroller data-testid="scroller" style={{ paddingTop: 4 }}>
        <p>A line</p>
      </MessageScroller>,
    );
    const scroller = screen.getByTestId("scroller");

    expect(scroller.style.maskImage).toBe("linear-gradient(to bottom, transparent, black 1rem)");
    expect(scroller.style.paddingTop).toBe("4px");
  });
});

describe("MessageScroller focus ring", () => {
  const mount = () => {
    render(
      <>
        <MessageScroller data-testid="scroller" tabIndex={0}>
          <button type="button">Copy</button>
        </MessageScroller>
        <button type="button">Outside</button>
      </>,
    );
    return screen.getByTestId("scroller");
  };
  const marked = (el: HTMLElement) => el.hasAttribute("data-mouse-focus");

  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("is dropped when a mouse press focuses the scroller, and back when Tab reaches it", async () => {
    const scroller = mount();
    expect(marked(scroller)).toBe(false);

    fireEvent.pointerDown(scroller);
    scroller.focus();
    expect(marked(scroller)).toBe(true);

    screen.getByText("Outside").focus();
    await nextTask();
    scroller.focus();
    expect(marked(scroller)).toBe(false);
  });

  test("a press that did not focus the scroller leaves no mark for a later Tab", async () => {
    const scroller = mount();
    fireEvent.pointerDown(screen.getByText("Copy"));
    await nextTask();

    scroller.focus();

    expect(marked(scroller)).toBe(false);
  });

  test("is dropped once the wheel scrolls the scroller", () => {
    const scroller = mount();
    scroller.focus();
    expect(marked(scroller)).toBe(false);

    fireEvent.wheel(scroller);

    expect(marked(scroller)).toBe(true);
  });
});
