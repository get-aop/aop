import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { MessageScroller } from "./message-scroller";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  cleanup();
});

describe("MessageScroller", () => {
  test("smoothly follows small live-stream growth without browser anchor snaps", () => {
    const scrollCalls: ScrollToOptions[] = [];
    const view = (streaming: boolean) => (
      <MessageScroller data-testid="scroller" streaming={streaming}>
        <div>Live response</div>
      </MessageScroller>
    );
    const { rerender } = render(view(false));
    const scroller = screen.getByTestId("scroller");

    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 240 },
      scrollTop: { configurable: true, value: 120, writable: true },
      scrollTo: {
        configurable: true,
        value: (options: ScrollToOptions) => scrollCalls.push(options),
      },
    });
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;

    rerender(view(true));

    expect(scroller.style.overflowAnchor).toBe("none");
    expect(scrollCalls).toContainEqual({ top: 240, behavior: "smooth" });
    expect(scroller.scrollTop).toBe(120);
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
