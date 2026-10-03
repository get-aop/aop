import { type RefObject, useEffect } from "react";

/*
 * What a view shown in the coordinator chat's place (a pull request, an issue) does with the
 * keyboard: it takes focus from the hidden chat, and Escape closes it.
 */

/**
 * The chat is hidden, not unmounted, so focus left in its composer would stay in a field no one
 * sees, and keys (Escape among them) would still go there. The pane takes it instead; focus in
 * the threads panel (a chip just clicked) stays where it is.
 */
export const useTakeFocusFromHiddenChat = (
  pane: RefObject<HTMLDivElement | null>,
  shown: string,
) => {
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

/** Escape closes the view, after whatever is on top: a field being typed in, a menu, a dialog. */
export const useEscapeCloses = (close: () => void): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isEditable(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
};

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable);
