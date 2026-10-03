/**
 * Where the live view's popup sits. It always rests in one of the window's four corners: a drag
 * moves it freely, and letting go snaps it to the nearest corner, which is what is remembered.
 * Its place is worked out from that corner, the window's size and what it must keep clear on
 * every render, so a resize never leaves it outside the window.
 */
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const CORNERS: readonly Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/**
 * Bottom right: on the project screen that is the foot of the threads panel, which is usually
 * empty because the Resolved group there starts folded. A bottom corner rests above any composer
 * in its column (see `restingPlace`), so the send buttons stay clear.
 */
export const DEFAULT_CORNER: Corner = "bottom-right";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Space kept free around the popup: a margin at the sides and bottom, and at the top the top bar
 * (56px) plus the two header rows of a pull request or an artifact shown in the chat's column
 * (its breadcrumb and its toolbar, down to 145px), so a top corner never covers their controls.
 */
export const INSETS = { top: 152, right: 12, bottom: 12, left: 12 } as const;

/** The popup's width: a small square-ish window, narrower on a narrow screen. */
export const popupWidth = (viewportWidth: number): number =>
  Math.round(Math.min(288, Math.max(160, viewportWidth * 0.42)));

/** A box on screen, in viewport pixels (a DOMRect's edges). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a popup of `size` rests in `corner`, and the corner that is (`shown`). A bottom corner
 * rests with its bottom edge at `floor` (the top of what it keeps clear, see `floorAbove`). When
 * that leaves no room below the top inset (a short window, a tall composer), it rests in the top
 * corner on the same side instead, as it did before bottom right was the default.
 */
export const restingPlace = (
  corner: Corner,
  size: Size,
  viewport: Size,
  floor: number,
): { position: Point; shown: Corner } => {
  if (corner.startsWith("top"))
    return { position: cornerPosition(corner, size, viewport), shown: corner };
  const y = Math.min(floor, viewport.height - INSETS.bottom) - size.height;
  const side = corner.endsWith("left") ? "left" : "right";
  if (y < INSETS.top) {
    const top: Corner = `top-${side}`;
    return { position: cornerPosition(top, size, viewport), shown: top };
  }
  const x = cornerPosition(corner, size, viewport).x;
  return { position: clampToViewport({ x, y }, size, viewport), shown: corner };
};

/**
 * The lowest a bottom corner's popup may reach in the column from `left` to `right`: a margin
 * above the highest of the `keepClear` boxes (composers) it would overlap, or the window's
 * bottom margin when there is none.
 */
export const floorAbove = (
  keepClear: readonly Rect[],
  column: { left: number; right: number },
  viewport: Size,
): number =>
  keepClear
    .filter((box) => box.left < column.right && box.right > column.left && box.bottom > box.top)
    .reduce(
      (floor, box) => Math.min(floor, box.top - INSETS.bottom),
      viewport.height - INSETS.bottom,
    );

/** The columns a popup `width` wide spans in the left and right corners. */
export const cornerColumn = (
  corner: Corner,
  width: number,
  viewport: Size,
): { left: number; right: number } => {
  const left = corner.endsWith("left")
    ? INSETS.left
    : Math.max(0, viewport.width - INSETS.right - width);
  return { left, right: left + width };
};

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
