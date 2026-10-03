import { type RefObject, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { Rect } from "./placement";

/**
 * Room for what the popup covers at the bottom of a list. While it rests in a bottom corner, a
 * list it sits over (the threads overview, a transcript) adds space at its end, so its last rows
 * (and the threads' Resolved toggle) can be scrolled up out from under it.
 */

/** Space kept between a list's last row and the popup's top edge. */
const GAP = 12;

/** Marks what a popup resting in a bottom corner must sit above: a composer and its send button. */
export const KEEP_CLEAR_ATTRIBUTE = "data-live-view-keep-clear";

let resting: Rect | null = null;
const listeners = new Set<() => void>();

/** Where the popup rests when that is a bottom corner, or null (top corner, dragged, hidden). */
export const setPopupAtBottom = (rect: Rect | null): void => {
  if (sameRect(resting, rect)) return;
  resting = rect;
  for (const listener of listeners) listener();
};

/**
 * The space the element in `ref` needs at its end so its last row clears the popup: none unless
 * the popup rests at the bottom over its column. The element's parent is the scroll container
 * whose visible bottom the popup covers.
 */
export const useLiveViewClearance = (ref: RefObject<HTMLElement | null>): number => {
  const popup = useSyncExternalStore(subscribe, () => resting);
  const [clearance, setClearance] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !popup) {
      setClearance(0);
      return;
    }
    const area = element.getBoundingClientRect();
    const visibleBottom = element.parentElement?.getBoundingClientRect().bottom ?? area.bottom;
    setClearance(clearanceFor(popup, area, visibleBottom));
  }, [popup, ref]);
  return clearance;
};

/** How much of `area`'s visible bottom (`visibleBottom`) the `popup` covers, plus a gap; 0 when it is not over it. */
export const clearanceFor = (popup: Rect, area: Rect, visibleBottom: number): number => {
  const over = popup.left < area.right && popup.right > area.left && popup.top < visibleBottom;
  return over ? Math.round(visibleBottom - popup.top + GAP) : 0;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom);
