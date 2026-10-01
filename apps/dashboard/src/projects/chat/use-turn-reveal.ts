import type { MessageBlock } from "@aop/common";
import { useEffect, useMemo, useRef, useState } from "react";
import { advanceReveal, lengthOf, proseOf, revealedBlocks, shownChars } from "./turn-reveal";

/** How long a word at the end of prose still arriving waits for the rest of it. */
export const WORD_WAIT_MS = 300;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A reply's blocks as the person should see them now. What exists when the row mounts shows at
 * once (a message from history, or a reply joined mid-turn); prose that arrives after is typed
 * out word by word, at most about 0.4 s behind. When the turn ends, what is left drains at the same
 * pace instead of appearing at once. `revealing` is true until the reveal has caught up.
 */
export const useTurnReveal = (
  blocks: readonly MessageBlock[],
  writing: boolean,
): { blocks: readonly MessageBlock[]; revealing: boolean } => {
  const texts = useMemo(() => proseOf(blocks), [blocks]);
  const total = lengthOf(texts);
  const [revealed, setRevealed] = useState(total);
  const totalRef = useRef(total);
  totalRef.current = total;

  const caughtUp = revealed >= total;
  useEffect(() => {
    if (caughtUp) return;
    if (prefersReducedMotion()) {
      setRevealed(totalRef.current);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const seconds = Math.max(0, (now - last) / 1000);
      last = now;
      setRevealed((current) => advanceReveal(current, totalRef.current, seconds));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [caughtUp]);

  // Prose that shrank (a baseline that replaced it) leaves the reveal where it now ends.
  useEffect(() => {
    if (revealed > total) setRevealed(total);
  }, [revealed, total]);

  // A word at the end waits for the rest of it, but not for long: the prose may have ended there.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    void total;
    setStalled(false);
    const timer = setTimeout(() => setStalled(true), WORD_WAIT_MS);
    return () => clearTimeout(timer);
  }, [total]);

  // Only prose that is still the newest thing the agent writes can end in the middle of a word.
  const growing = writing && !stalled && blocks.at(-1)?.type === "text";
  const chars = shownChars(texts, revealed, growing);
  const shown = useMemo(() => revealedBlocks(blocks, chars), [blocks, chars]);
  return { blocks: shown, revealing: revealed < total || chars < total };
};
