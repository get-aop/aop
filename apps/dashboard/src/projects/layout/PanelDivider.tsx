import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { PANEL_MIN_WIDTH } from "./panel-layout";

const KEY_STEP = 24;

/**
 * The line between the chat and the panel. Dragging it (or the arrow keys, with it focused)
 * resizes the panel, which sits against the right edge of `containerRef`.
 */
export const PanelDivider = ({
  width,
  containerRef,
  onResize,
}: {
  width: number;
  containerRef: RefObject<HTMLDivElement | null>;
  onResize: (width: number) => void;
}) => {
  const [dragging, setDragging] = useState(false);

  // The pointer leaves the thin line as soon as it moves, so a drag follows the window, not the line.
  useEffect(() => {
    if (!dragging) return;
    const move = (event: globalThis.PointerEvent) => {
      const container = containerRef.current;
      if (container) onResize(container.getBoundingClientRect().right - event.clientX);
    };
    const end = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging, containerRef, onResize]);

  const onPointerDown = (event: PointerEvent<HTMLHRElement>) => {
    if (event.button !== 0) return;
    // No text selection while the line is held.
    event.preventDefault();
    setDragging(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    const grow = event.key === "ArrowLeft" ? KEY_STEP : event.key === "ArrowRight" ? -KEY_STEP : 0;
    if (grow === 0) return;
    event.preventDefault();
    onResize(width + grow);
  };

  return (
    <hr
      aria-orientation="vertical"
      aria-label="Resize the threads panel"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN_WIDTH}
      tabIndex={0}
      data-testid="panel-divider"
      data-dragging={dragging}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // A wide grab area around a one-pixel line: only the content box is painted.
      className={cn(
        "z-10 -mx-1 h-auto w-2 shrink-0 cursor-col-resize touch-none self-stretch border-0 bg-border bg-clip-content px-[3.5px] outline-none transition-colors duration-[120ms] hover:bg-border-bold focus-visible:bg-running",
        dragging && "bg-running",
      )}
    />
  );
};
