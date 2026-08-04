export interface ShortcutActions {
  toggleCommandPalette: () => void;
  newSession: () => void;
  openSettings: () => void;
}

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/**
 * Global keyboard map (PLAN §4.2). ⌘B is handled by the sidebar provider
 * itself (SIDEBAR_KEYBOARD_SHORTCUT), ⌘J by the sessions workspace — this
 * routes the rest. Editable targets only yield to ⌘K/⌘, so typing is never
 * eaten (esp. ⌘N inside the composer).
 */
export const handleGlobalShortcut = (event: KeyboardEvent, actions: ShortcutActions): boolean => {
  if (!(event.metaKey || event.ctrlKey)) return false;

  if (event.key === "k") {
    event.preventDefault();
    actions.toggleCommandPalette();
    return true;
  }
  if (event.key === ",") {
    event.preventDefault();
    actions.openSettings();
    return true;
  }
  if (isEditableTarget(event.target)) return false;
  if (event.key === "n") {
    event.preventDefault();
    actions.newSession();
    return true;
  }
  return false;
};
