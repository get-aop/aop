import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/cn";

interface MessageScrollerProps extends React.ComponentProps<"div"> {
  /** Each change takes the view to the end and follows it again: the person just said something. */
  followKey?: number;
  /** Access to the scroll element (minimap, scroll-to-end affordances). */
  scrollerRef?: React.Ref<HTMLDivElement | null>;
  /** Called when the view starts or stops following the end. */
  onEdgeChange?: (atEdge: boolean) => void;
  children: React.ReactNode;
}

/** Scrolling back to within this distance of the end follows it again. */
const EDGE_THRESHOLD_PX = 48;

/**
 * The pane header above a transcript has the transcript's own background, so a line scrolled half
 * under it looked like letters with their tops cut off by a bar (#385). Fading the top edge makes
 * it read as text scrolling away. The content's top padding is taller than the fade, so nothing is
 * faded while the transcript is scrolled to its start.
 */
const TOP_EDGE_FADE = "linear-gradient(to bottom, transparent, black 1rem)";

/**
 * THE thread scroll container, with one rule: while the person is at the end, it stays there.
 * Whenever the content or the view changes size, a ResizeObserver puts the end in view before
 * the frame is painted, by setting `scrollTop` directly: no animation to restart, no frame in
 * which the text sits a few pixels off. Scrolling up stops following; scrolling back to the end
 * (or `followKey`) follows again. When not following, the browser's own scroll anchoring keeps
 * what the person reads in place, and older history that loads above keeps its place too.
 */
function MessageScroller({
  followKey,
  scrollerRef,
  onEdgeChange,
  onScroll,
  className,
  style,
  children,
  ...props
}: MessageScrollerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastTop = useRef(0);
  const lastHeight = useRef(0);
  // Where the view was when it was hidden (display: none), to go back to when it shows again.
  const hiddenTop = useRef<number | null>(null);
  const onEdgeChangeRef = useRef(onEdgeChange);
  onEdgeChangeRef.current = onEdgeChange;

  const assignRef = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      if (typeof scrollerRef === "function") scrollerRef(el);
      else if (scrollerRef) scrollerRef.current = el;
    },
    [scrollerRef],
  );

  const setFollowing = useCallback((value: boolean) => {
    const el = ref.current;
    // Following is this component's job; anchoring would fight it at the end.
    if (el) el.style.overflowAnchor = value ? "none" : "auto";
    if (following.current === value) return;
    following.current = value;
    onEdgeChangeRef.current?.(value);
  }, []);

  const pinToEnd = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, []);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = ref.current;
      // Hidden, the view reads scrollTop 0: that is not the person scrolling.
      if (el && el.clientHeight > 0) {
        setFollowing(followsAfterScroll(el, lastTop.current, following.current));
        lastTop.current = el.scrollTop;
      }
      onScroll?.(event);
    },
    [onScroll, setFollowing],
  );

  useLayoutEffect(() => {
    void followKey;
    setFollowing(true);
    pinToEnd();
  }, [followKey, setFollowing, pinToEnd]);

  // Every commit while following, before it is painted: a row that just mounted (a reply starting)
  // is in view from its first frame, without waiting for the observer.
  useLayoutEffect(() => {
    if (following.current) pinToEnd();
  });

  useEffect(() => {
    const el = ref.current;
    const content = el?.firstElementChild;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    lastHeight.current = el.scrollHeight;
    const observer = new ResizeObserver(() => {
      // Hidden (display: none), the view has no size and the browser drops its scroll position.
      if (el.clientHeight === 0) {
        hiddenTop.current ??= lastTop.current;
        return;
      }
      const grewBy = el.scrollHeight - lastHeight.current;
      lastHeight.current = el.scrollHeight;
      const top = topAfterResize(el, following.current, grewBy, hiddenTop.current);
      hiddenTop.current = null;
      if (top === null) return;
      el.scrollTop = top;
      lastTop.current = el.scrollTop;
    });
    observer.observe(content);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useMouseFocusMark(ref);

  return (
    <div
      ref={assignRef}
      data-slot="message-scroller"
      onScroll={handleScroll}
      // A wheel turned up means "stop following" at once, before a streaming commit pins the end
      // again ahead of the scroll event.
      onWheel={(event) => {
        if (event.deltaY < 0 && event.currentTarget.scrollTop > 0) setFollowing(false);
      }}
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      style={{ maskImage: TOP_EDGE_FADE, WebkitMaskImage: TOP_EDGE_FADE, ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

/** Where the view goes when it or its content changes size; null leaves it where it is. */
const topAfterResize = (
  el: HTMLElement,
  following: boolean,
  grewBy: number,
  shownAgainAt: number | null,
): number | null => {
  if (following) return el.scrollHeight;
  // Shown again (the chat back from a pull request or an artifact): where the person left it.
  if (shownAgainAt !== null) return shownAgainAt;
  // Older history loaded above the top of the view: keep the message that was there.
  if (grewBy > 0 && el.scrollTop < 4) return el.scrollTop + grewBy;
  return null;
};

/**
 * Whether the view follows the end after a scroll: at the end it does; a scroll up stops it, even
 * a small one; a scroll down that comes near the end starts it again.
 */
const followsAfterScroll = (el: HTMLElement, lastTop: number, following: boolean): boolean => {
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (distance <= 1) return true;
  if (el.scrollTop < lastTop - 1) return false;
  return following || distance <= EDGE_THRESHOLD_PX;
};

/**
 * Marks the scroller `data-mouse-focus` once the mouse presses or wheels in it, so CSS can drop
 * its focus ring; focus that reaches it any other way (Tab) clears the mark. Chrome can focus a
 * scroller and then count a scrolling key (Page Down, arrows) as keyboard use, which drew a ring
 * round the whole transcript after a click.
 */
function useMouseFocusMark(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A press focuses in the same task, so the flag only has to last until the next one.
    let pressing = false;
    const mark = () => el.setAttribute("data-mouse-focus", "");
    const onPress = () => {
      pressing = true;
      mark();
      setTimeout(() => {
        pressing = false;
      }, 0);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target === el && !pressing) el.removeAttribute("data-mouse-focus");
    };
    el.addEventListener("pointerdown", onPress);
    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("focusin", onFocusIn);
    return () => {
      el.removeEventListener("pointerdown", onPress);
      el.removeEventListener("wheel", mark);
      el.removeEventListener("focusin", onFocusIn);
    };
  }, [ref]);
}

export { MessageScroller };
