import { useEffect, useRef, useState } from "react";

/** Base reveal pace in characters per animation frame (~500 chars/sec). */
const FRAME_ADVANCE = 8;
/** Per-frame burst cap: even a huge server chunk still takes a few frames. */
const MAX_FRAME_ADVANCE = 200;
/** Proportional catch-up so the reveal never lags far behind the incoming stream. */
const CATCH_UP_FRACTION = 0.25;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveals live-streaming text at a natural typing pace instead of painting
 * whole server chunks at once. Returns the prefix of `target` that should be
 * visible right now.
 *
 * - While `active`, the prefix grows every animation frame: a small base pace
 *   plus a fraction of the remaining gap, capped so a large chunk still takes
 *   a few frames to appear.
 * - When `active` is false (finished run, history view) or the user prefers
 *   reduced motion, the full `target` is returned immediately.
 */
export const useStreamingReveal = (target: string, active: boolean): string => {
  const [displayed, setDisplayed] = useState(() => (active ? "" : target));
  const displayedRef = useRef(displayed);

  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      if (displayedRef.current !== target) {
        displayedRef.current = target;
        setDisplayed(target);
      }
      return;
    }
    if (displayedRef.current.length > target.length) {
      // A replay frame replaced the text with something shorter: snap down.
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }
    let frame = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const current = displayedRef.current;
      const remaining = target.length - current.length;
      if (remaining <= 0) return;
      const advance = Math.min(
        MAX_FRAME_ADVANCE,
        FRAME_ADVANCE + Math.ceil(remaining * CATCH_UP_FRACTION),
      );
      const next = target.slice(0, current.length + Math.min(advance, remaining));
      displayedRef.current = next;
      setDisplayed(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [target, active]);

  return displayed;
};
