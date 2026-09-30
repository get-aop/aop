import { useEffect, useRef, useState } from "react";

/** Slowest pace (chars/second) — visible typing for slow models. */
const MIN_CHARS_PER_SECOND = 26;
/** Fastest pace (chars/second) — very fast typing for fast models, never a dump. */
const MAX_CHARS_PER_SECOND = 600;
/** Reveal runs a little slower than the model so it never outruns the output. */
const FOLLOW_RATIO = 0.85;
/** Weight of the newest observed model rate in the smoothed estimate. */
const RATE_SMOOTHING = 0.35;
/** A backlog of this size is drained by the catch-up term in ~this many seconds. */
const CATCH_UP_WINDOW_SECONDS = 1.5;
/** Extra pace (chars/second) the catch-up term may add on top of the follow pace. */
const MAX_CATCH_UP_CHARS_PER_SECOND = 400;
/** Cap a single frame gap so a backgrounded tab cannot teleport the reveal. */
const MAX_FRAME_DELTA_SECONDS = 0.1;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveals live-streaming text like a user typing. Returns the prefix of
 * `target` that should be visible right now.
 *
 * - While `active`, the prefix grows at the model's own output pace (slightly
 *   slower, so it never outruns the stream) bounded by a natural-typing floor
 *   and a fast-typing ceiling. A gentle catch-up term drains any backlog
 *   whenever the model pauses.
 * - When `active` is false (finished run, history view) or the user prefers
 *   reduced motion, the full `target` is returned immediately.
 */
export const useStreamingReveal = (target: string, active: boolean): string => {
  const [displayed, setDisplayed] = useState(() => (active ? "" : target));
  const displayedRef = useRef(displayed);
  const lastTickRef = useRef(0);
  /** Smoothed model output rate (chars/second), measured from target growth. */
  const modelRateRef = useRef(0);
  /** Target length as of the last tick — the baseline for rate measurement. */
  const measuredTargetLengthRef = useRef(target.length);
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
    if (displayedRef.current.length === target.length) {
      // Fully caught up: keep the rate estimate decaying so a fresh burst
      // re-enters with the natural typing floor instead of a stale spike.
      modelRateRef.current *= 1 - RATE_SMOOTHING;
      return;
    }

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
      const pace = revealPace(
        deltaSeconds,
        target.length,
        modelRateRef,
        measuredTargetLengthRef,
        remaining,
      );
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

/**
 * Reveal pace for one frame: follow the model's observed output rate (slightly
 * slower, so the reveal never outruns the stream), floored at natural typing
 * and capped at very fast typing, plus a catch-up term that drains any backlog
 * within a few seconds while the model pauses.
 */
const revealPace = (
  deltaSeconds: number,
  targetLength: number,
  modelRateRef: { current: number },
  measuredTargetLengthRef: { current: number },
  remaining: number,
): number => {
  // Model rate: how much new text arrived since the last tick (smoothed),
  // so a bursty provider sets a fast pace and a stalled one decays.
  const incoming = Math.max(0, targetLength - measuredTargetLengthRef.current);
  measuredTargetLengthRef.current = targetLength;
  if (deltaSeconds > 0) {
    const instant = incoming / deltaSeconds;
    modelRateRef.current = modelRateRef.current * (1 - RATE_SMOOTHING) + instant * RATE_SMOOTHING;
  }
  const follow = Math.min(
    MAX_CHARS_PER_SECOND,
    Math.max(MIN_CHARS_PER_SECOND, modelRateRef.current * FOLLOW_RATIO),
  );
  const catchUp = Math.min(MAX_CATCH_UP_CHARS_PER_SECOND, remaining / CATCH_UP_WINDOW_SECONDS);
  return Math.min(MAX_CHARS_PER_SECOND, follow + catchUp);
};
