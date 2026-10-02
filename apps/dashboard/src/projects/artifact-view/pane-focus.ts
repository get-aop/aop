import { type RefObject, useEffect, useRef } from "react";

/**
 * The chat is hidden under a view in its place, not unmounted, so focus left in its composer
 * would stay in a field no one sees, and keys (Escape among them) would still go there. The view
 * takes it instead; focus in the threads panel (a card just clicked there) stays where it is.
 * The same rule as the PR View's pane.
 */
export const useTakeFocusFromHiddenChat = (pane: RefObject<HTMLElement | null>, shown: string) => {
  useEffect(() => {
    void shown;
    const active = document.activeElement;
    const stranded =
      active === null ||
      active === document.body ||
      active.closest('[data-testid="chat-column"]') !== null;
    if (stranded) pane.current?.focus({ preventScroll: true });
  }, [pane, shown]);
};

/** Escape belongs to whatever is on top first: a field being typed in, a menu, a dialog. */
export const useEscape = (onEscape: () => void): void => {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isEditable(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      handler.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
};

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable);
