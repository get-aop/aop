import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { MessageScroller } from "./message-scroller";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");

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
