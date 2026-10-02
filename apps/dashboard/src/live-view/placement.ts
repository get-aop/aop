/**
 * Where the live view's popup sits. It always rests in one of the window's four corners: a drag
 * moves it freely, and letting go snaps it to the nearest corner, which is what is remembered.
 * Its place is worked out from that corner and the window's size on every render, so a resize
 * never leaves it outside the window.
 */
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const CORNERS: readonly Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/**
 * Top right, under the top bar: clear of the composers' send buttons (bottom right) and of the
 * top bar's controls, over the threads panel's list or the coordinator column's content.
 */
export const DEFAULT_CORNER: Corner = "top-right";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Space kept free around the popup: the top bar above, a margin elsewhere. */
export const INSETS = { top: 64, right: 12, bottom: 12, left: 12 } as const;

/** The popup's width: a small square-ish window, narrower on a narrow screen. */
export const popupWidth = (viewportWidth: number): number =>
  Math.round(Math.min(288, Math.max(160, viewportWidth * 0.42)));

/** The top-left point of a popup of `size` resting in `corner`, kept inside the viewport. */
export const cornerPosition = (corner: Corner, size: Size, viewport: Size): Point => {
  const left = INSETS.left;
  const right = viewport.width - INSETS.right - size.width;
  const top = INSETS.top;
  const bottom = viewport.height - INSETS.bottom - size.height;
  return clampToViewport(
    {
      x: corner.endsWith("left") ? left : right,
      y: corner.startsWith("top") ? top : bottom,
    },
    size,
    viewport,
  );
};

/** The corner nearest to where the popup's centre was let go. */
export const nearestCorner = (position: Point, size: Size, viewport: Size): Corner => {
  const centreX = position.x + size.width / 2;
  const centreY = position.y + size.height / 2;
  const horizontal = centreX < viewport.width / 2 ? "left" : "right";
  const vertical = centreY < viewport.height / 2 ? "top" : "bottom";
  return `${vertical}-${horizontal}`;
};

/** Keeps a dragged popup on screen: never past an edge, and under the top bar when it fits. */
export const clampToViewport = (position: Point, size: Size, viewport: Size): Point => ({
  x: clamp(position.x, 0, Math.max(0, viewport.width - size.width)),
  y: clamp(position.y, 0, Math.max(0, viewport.height - size.height)),
});

export const isCorner = (value: unknown): value is Corner =>
  typeof value === "string" && (CORNERS as readonly string[]).includes(value);

/** A pointer that moved less than this between press and release clicked; more, it dragged. */
export const DRAG_THRESHOLD_PX = 4;

export const movedPastThreshold = (from: Point, to: Point): boolean =>
  Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD_PX;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
