import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

interface MessageScrollerProps extends React.ComponentProps<"div"> {
  /** True while the assistant is streaming — keeps the view pinned to the live edge. */
  streaming?: boolean;
  /** Increments when a new turn is anchored (e.g. message count). */
  anchorKey?: number;
  /** Access to the scroll element (minimap, scroll-to-end affordances). */
  scrollerRef?: React.Ref<HTMLDivElement | null>;
  /** Called when the user leaves/returns to the live edge. */
  onEdgeChange?: (atEdge: boolean) => void;
  children: React.ReactNode;
}

const EDGE_THRESHOLD_PX = 48;

/**
 * THE thread scroll container. Live-edge follow while streaming, anchors new
 * turns, and preserves scroll position when older history prepends. Replaces
 * the bespoke auto-scroll code in ChatThread — do not port it.
 */
function MessageScroller({
  streaming = false,
  anchorKey,
  scrollerRef,
  onEdgeChange,
  onScroll,
  className,
  children,
  ...props
}: MessageScrollerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stickToEdgeRef = useRef(true);
  const prevScrollHeightRef = useRef(0);

  const assignRef = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      if (typeof scrollerRef === "function") scrollerRef(el);
      else if (scrollerRef) scrollerRef.current = el;
    },
    [scrollerRef],
  );

  const scrollToEdge = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (el) {
        const at = el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_THRESHOLD_PX;
        if (at !== stickToEdgeRef.current) {
          stickToEdgeRef.current = at;
          onEdgeChange?.(at);
        }
      }
      onScroll?.(event);
    },
    [onScroll, onEdgeChange],
  );

  // Follow the live edge while streaming (only when the user hasn't scrolled up).
  useEffect(() => {
    if (streaming && stickToEdgeRef.current) {
      requestAnimationFrame(scrollToEdge);
    }
  });

  // Content growth (images, folds) also nudges the live edge while streaming.
  useEffect(() => {
    const el = ref.current;
    const content = el?.firstElementChild;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToEdgeRef.current) requestAnimationFrame(scrollToEdge);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToEdge]);

  // Anchor new turns: jump to the edge when a turn is added while at the edge.
  useEffect(() => {
    if (anchorKey === undefined) return;
    if (stickToEdgeRef.current) requestAnimationFrame(scrollToEdge);
  }, [anchorKey, scrollToEdge]);

  // Preserve position on history load: when content prepends (scrollHeight
  // grows while scrolled at the very top), keep the same anchor message.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = prevScrollHeightRef.current;
    const next = el.scrollHeight;
    if (previous > 0 && next > previous && !stickToEdgeRef.current && el.scrollTop < 4) {
      el.scrollTop = next - previous;
    }
    prevScrollHeightRef.current = next;
  });

  return (
    <div
      ref={assignRef}
      data-slot="message-scroller"
      onScroll={handleScroll}
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { MessageScroller };
