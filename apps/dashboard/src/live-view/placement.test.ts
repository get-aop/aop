import { describe, expect, test } from "bun:test";
import {
  clampToViewport,
  cornerPosition,
  DEFAULT_CORNER,
  INSETS,
  isCorner,
  movedPastThreshold,
  nearestCorner,
  popupWidth,
} from "./placement";

const viewport = { width: 1200, height: 800 };
const size = { width: 288, height: 212 };

describe("live view placement", () => {
  test("rests in a corner, clear of the top bar and a covering view's headers at the top", () => {
    expect(cornerPosition("top-left", size, viewport)).toEqual({ x: 12, y: INSETS.top });
    expect(cornerPosition("top-right", size, viewport)).toEqual({ x: 1200 - 12 - 288, y: 152 });
    expect(cornerPosition("bottom-left", size, viewport)).toEqual({ x: 12, y: 800 - 12 - 212 });
    expect(cornerPosition("bottom-right", size, viewport)).toEqual({ x: 900, y: 576 });
  });

  test("starts top right, away from the composers' send buttons at the bottom", () => {
    expect(DEFAULT_CORNER).toBe("top-right");
  });

  test("snaps to the corner nearest to where it was let go", () => {
    expect(nearestCorner({ x: 100, y: 100 }, size, viewport)).toBe("top-left");
    expect(nearestCorner({ x: 700, y: 100 }, size, viewport)).toBe("top-right");
    expect(nearestCorner({ x: 200, y: 500 }, size, viewport)).toBe("bottom-left");
    expect(nearestCorner({ x: 1000, y: 700 }, size, viewport)).toBe("bottom-right");
  });

  test("stays inside the window when the window shrinks", () => {
    const small = { width: 400, height: 300 };
    const position = cornerPosition("bottom-right", size, small);
    expect(position.x + size.width).toBeLessThanOrEqual(400);
    expect(position.y + size.height).toBeLessThanOrEqual(300);
    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(clampToViewport({ x: -50, y: 900 }, size, small)).toEqual({ x: 0, y: 88 });
  });

  test("is narrower on a narrow window: 168px at 400px wide, 288px at most", () => {
    expect(popupWidth(400)).toBe(168);
    expect(popupWidth(1440)).toBe(288);
    expect(popupWidth(300)).toBe(160);
  });

  test("a press that barely moves is a click, not a drag", () => {
    expect(movedPastThreshold({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false);
    expect(movedPastThreshold({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
  });

  test("only the four corners are corners", () => {
    expect(isCorner("bottom-left")).toBe(true);
    expect(isCorner("middle")).toBe(false);
    expect(isCorner(null)).toBe(false);
  });
});
