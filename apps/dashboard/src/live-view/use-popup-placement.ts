import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocalStorage } from "../hooks/use-local-storage";
import {
  type Corner,
  clampToViewport,
  cornerPosition,
  DEFAULT_CORNER,
  isCorner,
  movedPastThreshold,
  nearestCorner,
  type Point,
  type Size,
} from "./placement";

const CORNER_KEY = "aop:live-view:corner";

/**
 * Drags the popup by the pointer and snaps it to the nearest corner when let go, remembering
 * the corner. A press that does not move past the drag threshold is a click: `onClick` gets it
 * (the popup's picture opens full screen on one). The popup is placed from its corner and the
 * window's size, so it follows a resize.
 */
export const usePopupPlacement = (
  size: Size,
  viewport: Size,
  onClick: (target: EventTarget) => void,
) => {
  const [stored, setStored] = useLocalStorage<string>(CORNER_KEY, DEFAULT_CORNER);
  const corner: Corner = isCorner(stored) ? stored : DEFAULT_CORNER;
  const [dragAt, setDragAt] = useState<Point | null>(null);
  const press = useRef<{ pointer: Point; origin: Point; dragging: boolean } | null>(null);

  const resting = cornerPosition(corner, size, viewport);
  const position = dragAt ? clampToViewport(dragAt, size, viewport) : resting;

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || isControl(event.target)) return;
      press.current = {
        pointer: { x: event.clientX, y: event.clientY },
        origin: resting,
        dragging: false,
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
        onClick(event.target);
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
    corner,
    position,
    dragging: dragAt !== null,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
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
