import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { MarkdownPanelSplitter, clampPanelWidth, readStoredPanelWidth } = await import(
  "./SessionsPage"
);

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("MarkdownPanelSplitter", () => {
  test("uses container-relative pointer math", () => {
    const onWidthChange = mock((_width: number) => {});
    render(
      <div>
        <MarkdownPanelSplitter width={460} onWidthChange={onWidthChange} />
      </div>,
    );
    const splitter = screen.getByRole("separator");
    Object.defineProperty(splitter.parentElement, "getBoundingClientRect", {
      value: () => ({ right: 1000 }),
    });
    fireEvent.pointerDown(splitter, { pointerId: 1, clientX: 540 });
    fireEvent.pointerMove(window, { clientX: 400 });
    expect(onWidthChange).toHaveBeenCalledWith(600);
  });

  test("resets on double click and adjusts by 24 with keyboard", () => {
    const onWidthChange = mock((_width: number) => {});
    render(<MarkdownPanelSplitter width={540} onWidthChange={onWidthChange} />);
    const splitter = screen.getByRole("separator");
    fireEvent.doubleClick(splitter);
    fireEvent.keyDown(splitter, { key: "ArrowLeft" });
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(onWidthChange.mock.calls.map(([width]) => width)).toEqual([540, 564, 516]);
  });

  test("clamps bounds and restores a stored width", () => {
    expect(clampPanelWidth(100, 1000)).toBe(360);
    expect(clampPanelWidth(1200, 1000)).toBe(700);
    expect(readStoredPanelWidth()).toBe(540);
    localStorage.setItem("aop:md-panel-width", "512");
    expect(readStoredPanelWidth()).toBe(512);
  });
});
