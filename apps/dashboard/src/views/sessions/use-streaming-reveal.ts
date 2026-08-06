import { useEffect, useRef, useState } from "react";

/** Steady reveal pace in characters per second — fast typing, clearly visible. */
const BASE_CHARS_PER_SECOND = 24;
/** Reveal ceiling while catching up a backlog (characters per second). */
const MAX_CHARS_PER_SECOND = 72;
/** A backlog of this size is fully absorbed by the catch-up in ~10 seconds. */
const CATCH_UP_WINDOW_SECONDS = 10;
/** Cap a single frame gap so a backgrounded tab cannot teleport the reveal. */
const MAX_FRAME_DELTA_SECONDS = 0.1;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveals live-streaming text at a natural typing pace instead of painting
 * whole server chunks at once. Returns the prefix of `target` that should be
 * visible right now.
 *
 * - While `active`, the prefix grows at a steady per-second pace (time-based,
 *   so 60Hz and 120Hz displays type at the same speed), plus a gentle
 *   catch-up term that absorbs a large backlog within a few seconds instead
 *   of dumping it in one frame.
 * - When `active` is false (finished run, history view) or the user prefers
 *   reduced motion, the full `target` is returned immediately.
 */
export const useStreamingReveal = (target: string, active: boolean): string => {
  const [displayed, setDisplayed] = useState(() => (active ? "" : target));
  const displayedRef = useRef(displayed);
  const lastTickRef = useRef(0);
  /** Fractional characters carried between frames so slow paces stay smooth. */
  const carryRef = useRef(0);

  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      if (displayedRef.current !== target) {
        displayedRef.current = target;
        setDisplayed(target);
      }
      return;
    }
    if (displayedRef.current.length > target.length) {
      // A replay frame replaced the text with something shorter: clamp, don't pop.
      displayedRef.current = target.slice(0, displayedRef.current.length);
      setDisplayed(displayedRef.current);
      return;
    }
    if (displayedRef.current.length === target.length) return;

    let frame = 0;
    let cancelled = false;
    lastTickRef.current = performance.now();
    carryRef.current = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      const deltaSeconds = Math.min(
        MAX_FRAME_DELTA_SECONDS,
        Math.max(0, (now - lastTickRef.current) / 1000),
      );
      lastTickRef.current = now;
      const current = displayedRef.current;
      const remaining = target.length - current.length;
      if (remaining <= 0) return;
      const pace =
        BASE_CHARS_PER_SECOND +
        Math.min(MAX_CHARS_PER_SECOND - BASE_CHARS_PER_SECOND, remaining / CATCH_UP_WINDOW_SECONDS);
      carryRef.current += pace * deltaSeconds;
      const advance = Math.min(remaining, Math.floor(carryRef.current));
      carryRef.current -= advance;
      if (advance > 0) {
        const next = target.slice(0, current.length + advance);
        displayedRef.current = next;
        setDisplayed(next);
      }
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
