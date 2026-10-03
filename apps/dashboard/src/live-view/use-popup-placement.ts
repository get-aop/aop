import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocalStorage } from "../hooks/use-local-storage";
import { KEEP_CLEAR_ATTRIBUTE } from "./live-view-clearance";
import {
  type Corner,
  clampToViewport,
  cornerColumn,
  DEFAULT_CORNER,
  floorAbove,
  isCorner,
  movedPastThreshold,
  nearestCorner,
  type Point,
  type Rect,
  restingPlace,
  type Size,
} from "./placement";

// Only a corner the person dragged it to is stored; until then the popup follows DEFAULT_CORNER.
const CORNER_KEY = "aop:live-view:corner";

/** How often what the popup keeps clear is measured again: a composer grows as it is typed in. */
const KEEP_CLEAR_EVERY_MS = 500;

/**
 * Drags the popup by the pointer and snaps it to the nearest corner when let go, remembering
 * the corner. A press that does not move past the drag threshold is a click: `onClick` gets it
 * (the popup's picture opens full screen on one). The popup is placed from its corner, the
 * window's size and the composers under it, so it follows a resize and a growing composer.
 */
export const usePopupPlacement = (
  size: Size,
  viewport: Size,
  onClick: (target: EventTarget) => void,
) => {
  const [stored, setStored] = useLocalStorage<string>(CORNER_KEY, DEFAULT_CORNER);
  const corner: Corner = isCorner(stored) ? stored : DEFAULT_CORNER;
  const [dragAt, setDragAt] = useState<Point | null>(null);
  const press = useRef<{
    pointer: Point;
    origin: Point;
    dragging: boolean;
    /** Where the press began: once the popup captures the pointer, the release targets the popup. */
    target: EventTarget;
  } | null>(null);

  const floor = useFloor(corner, size.width, viewport);
  const { position: resting, shown } = restingPlace(corner, size, viewport, floor);
  const position = dragAt ? clampToViewport(dragAt, size, viewport) : resting;

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || isControl(event.target)) return;
      press.current = {
        pointer: { x: event.clientX, y: event.clientY },
        origin: resting,
        dragging: false,
        target: event.target,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [resting],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = press.current;
    if (!current) return;
    const pointer = { x: event.clientX, y: event.clientY };
    if (!current.dragging && !movedPastThreshold(current.pointer, pointer)) return;
    current.dragging = true;
    setDragAt({
      x: current.origin.x + pointer.x - current.pointer.x,
      y: current.origin.y + pointer.y - current.pointer.y,
    });
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = press.current;
      press.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (!current) return;
      if (!current.dragging) {
        onClick(current.target);
        return;
      }
      const released = {
        x: current.origin.x + event.clientX - current.pointer.x,
        y: current.origin.y + event.clientY - current.pointer.y,
      };
      setStored(nearestCorner(clampToViewport(released, size, viewport), size, viewport));
      setDragAt(null);
    },
    [onClick, setStored, size, viewport],
  );

  const onPointerCancel = useCallback(() => {
    press.current = null;
    setDragAt(null);
  }, []);

  return {
    corner: shown,
    position,
    dragging: dragAt !== null,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
};

/**
 * The lowest a popup in a bottom `corner` may reach: above the composers in its column that are
 * on screen. Measured again on a timer, since a composer grows, and a pane opens or closes,
 * without the window changing size.
 */
const useFloor = (corner: Corner, width: number, viewport: Size): number => {
  const [floor, setFloor] = useState(viewport.height);
  const bottom = corner.startsWith("bottom");
  // Before the first paint, so the popup never shows over a composer and then jumps.
  useLayoutEffect(() => {
    if (!bottom) return;
    const measure = () => {
      const column = cornerColumn(corner, width, viewport);
      setFloor(floorAbove(keepClearIn(column), column, viewport));
    };
    measure();
    const timer = window.setInterval(measure, KEEP_CLEAR_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [bottom, corner, width, viewport]);
  return bottom ? floor : viewport.height;
};

/**
 * The boxes marked keep-clear that show in `column`: one hidden (display: none) has no box, and
 * one under another pane (the chat's composer under an overlaid threads panel) is not the
 * topmost thing at its own middle.
 */
const keepClearIn = (column: { left: number; right: number }): Rect[] =>
  Array.from(document.querySelectorAll(`[${KEEP_CLEAR_ATTRIBUTE}]`)).flatMap((element) => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return [];
    const x = Math.min(Math.max((column.left + column.right) / 2, box.left + 1), box.right - 1);
    return isOnTop(element, x, box.top + box.height / 2) ? [box] : [];
  });

// Floating things that come and go (the popup itself, a toast, a menu) do not hide a composer.
const FLOATING =
  "[data-testid=live-view-popup], [data-sonner-toaster], [data-radix-popper-content-wrapper]";

const isOnTop = (element: Element, x: number, y: number): boolean => {
  if (typeof document.elementsFromPoint !== "function") return true;
  const top = document.elementsFromPoint(x, y).find((hit) => !hit.closest(FLOATING));
  return top === undefined || element.contains(top);
};

/** The window's size, following resizes. */
export const useViewport = (): Size => {
  const [viewport, setViewport] = useState<Size>(readViewport);
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
};

const readViewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

// The header's buttons and link do their own thing; a press on them never starts a drag. The
// picture is a button for the keyboard's sake, but a press on it drags or clicks like the rest.
const isControl = (target: EventTarget): boolean =>
  target instanceof Element &&
  target.closest("button:not([data-live-view-body]), a, [role=menuitem]") !== null;
