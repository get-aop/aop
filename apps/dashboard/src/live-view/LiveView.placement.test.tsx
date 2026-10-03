import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useRef } from "react";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakeLiveHost } from "./test-utils";

setupDashboardDom();

const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { LiveView } = await import("./LiveView");
const { useLiveViewClearance } = await import("./live-view-clearance");
const { resetLiveViewForTests } = await import("./live-view-store");

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

const box = (left: number, top: number, right: number, bottom: number) => () =>
  ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
  }) as DOMRect;

/** A composer's footer, marked for the popup to keep clear, drawn where `rect` says. */
const Composer = ({ rect }: { rect: () => DOMRect }) => (
  <footer
    data-live-view-keep-clear
    ref={(element) => {
      if (element) element.getBoundingClientRect = rect;
    }}
  />
);

/** A scrolling list across the window's width, its end padded by the clearance it is given. */
const List = () => {
  const content = useRef<HTMLDivElement>(null);
  const clearance = useLiveViewClearance(content);
  return (
    <div
      ref={(element) => {
        if (element)
          element.getBoundingClientRect = box(0, 56, window.innerWidth, window.innerHeight);
      }}
    >
      <div
        ref={(element) => {
          content.current = element;
          if (element) element.getBoundingClientRect = box(0, 56, window.innerWidth, 2000);
        }}
        data-testid="list"
        data-clearance={clearance}
      />
    </div>
  );
};

const popup = () => waitFor(() => screen.getByTestId("live-view-popup"));
const top = (element: HTMLElement) => Number.parseFloat(element.style.top);
const height = (element: HTMLElement) => Number.parseFloat(element.style.height);

describe("where the popup starts", () => {
  test("bottom right, its bottom a margin above the window's bottom when nothing is under it", async () => {
    installFakeLiveHost();
    render(<LiveView />);
    const view = await popup();

    expect(view.dataset.corner).toBe("bottom-right");
    expect(top(view) + height(view)).toBe(window.innerHeight - 12);
  });

  test("above a composer in its column, so the send button stays clear", async () => {
    installFakeLiveHost();
    const composerTop = window.innerHeight - 140;
    render(
      <>
        <Composer
          rect={box(window.innerWidth - 520, composerTop, window.innerWidth, window.innerHeight)}
        />
        <LiveView />
      </>,
    );
    const view = await popup();

    await waitFor(() => expect(top(view) + height(view)).toBe(composerTop - 12));
    expect(view.dataset.corner).toBe("bottom-right");
  });

  test("top right when the composer leaves no room above it", async () => {
    installFakeLiveHost();
    render(
      <>
        <Composer rect={box(0, 200, window.innerWidth, window.innerHeight)} />
        <LiveView />
      </>,
    );
    const view = await popup();

    await waitFor(() => expect(view.dataset.corner).toBe("top-right"));
    expect(top(view)).toBe(152);
    expect(localStorage.getItem("aop:live-view:corner")).toBeNull();
  });

  test("a corner the person dragged it to is kept", async () => {
    localStorage.setItem("aop:live-view:corner", "top-left");
    installFakeLiveHost();
    render(<LiveView />);

    expect((await popup()).dataset.corner).toBe("top-left");
  });
});

describe("a list under the popup", () => {
  test("gets room at its end while the popup rests at the bottom over it", async () => {
    installFakeLiveHost();
    render(
      <>
        <List />
        <LiveView />
      </>,
    );
    const view = await popup();

    // From the popup's top edge to the list's visible bottom, and a gap.
    await waitFor(() =>
      expect(Number(screen.getByTestId("list").dataset.clearance)).toBe(
        window.innerHeight - top(view) + 12,
      ),
    );
  });

  test("gets none while the popup is in a top corner", async () => {
    localStorage.setItem("aop:live-view:corner", "top-right");
    installFakeLiveHost();
    render(
      <>
        <List />
        <LiveView />
      </>,
    );
    await popup();

    expect(screen.getByTestId("list").dataset.clearance).toBe("0");
  });
});
