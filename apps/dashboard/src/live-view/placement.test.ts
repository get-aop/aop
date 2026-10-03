import { describe, expect, test } from "bun:test";
import {
  clampToViewport,
  cornerColumn,
  cornerPosition,
  DEFAULT_CORNER,
  floorAbove,
  INSETS,
  isCorner,
  movedPastThreshold,
  nearestCorner,
  popupWidth,
  restingPlace,
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

  test("starts bottom right, in the gap under the threads list", () => {
    expect(DEFAULT_CORNER).toBe("bottom-right");
    const floor = floorAbove([], cornerColumn("bottom-right", 288, viewport), viewport);
    expect(restingPlace(DEFAULT_CORNER, size, viewport, floor)).toEqual({
      position: { x: 900, y: 576 },
      shown: "bottom-right",
    });
  });

  test("a bottom corner rests above a composer in its column, not one in another column", () => {
    // A thread's composer across the threads panel (right), the coordinator's in the chat (left).
    const threadComposer = { left: 700, top: 650, right: 1180, bottom: 788 };
    const chatComposer = { left: 24, top: 600, right: 640, bottom: 788 };
    const right = cornerColumn("bottom-right", 288, viewport);
    expect(right).toEqual({ left: 900, right: 1188 });

    const floor = floorAbove([threadComposer, chatComposer], right, viewport);
    expect(floor).toBe(650 - INSETS.bottom);
    expect(restingPlace("bottom-right", size, viewport, floor).position).toEqual({
      x: 900,
      y: 650 - 12 - 212,
    });

    const left = cornerColumn("bottom-left", 288, viewport);
    expect(floorAbove([threadComposer, chatComposer], left, viewport)).toBe(600 - 12);
  });

  test("a composer that is not on screen (no box) is not in the way", () => {
    const hidden = { left: 0, top: 0, right: 0, bottom: 0 };
    const column = cornerColumn("bottom-right", 288, viewport);
    expect(floorAbove([hidden], column, viewport)).toBe(800 - 12);
  });

  test("with no room above the composer it rests top right instead, and says so", () => {
    // A 400px phone-sized window, 420px tall: the composer leaves 120px above it.
    const small = { width: 400, height: 420 };
    const popup = { width: popupWidth(400), height: 32 + 105 };
    const composer = { left: 0, top: 280, right: 400, bottom: 420 };
    const floor = floorAbove([composer], cornerColumn("bottom-right", popup.width, small), small);
    expect(restingPlace("bottom-right", popup, small, floor)).toEqual({
      position: { x: 400 - 12 - 168, y: INSETS.top },
      shown: "top-right",
    });
    // Taller, the same window has room: back to the bottom.
    const tall = { width: 400, height: 800 };
    const lower = { ...composer, top: 660, bottom: 800 };
    const tallFloor = floorAbove([lower], cornerColumn("bottom-right", 168, tall), tall);
    expect(restingPlace("bottom-right", popup, tall, tallFloor)).toEqual({
      position: { x: 220, y: 660 - 12 - 137 },
      shown: "bottom-right",
    });
  });

  test("a top corner ignores the composers", () => {
    expect(restingPlace("top-left", size, viewport, 300)).toEqual({
      position: { x: 12, y: INSETS.top },
      shown: "top-left",
    });
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
