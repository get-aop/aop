export interface ShortcutActions {
  toggleProjectSwitcher: () => void;
  newProject: () => void;
  openSettings: () => void;
}

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/**
 * Global keyboard map: ⌘K opens the project switcher, ⌘, the AOP settings, ⌘N a new project.
 * ⌘J belongs to the sessions workspace. Editable targets only yield to ⌘K/⌘, so typing is never
 * eaten (esp. ⌘N inside the composer).
 */
export const handleGlobalShortcut = (event: KeyboardEvent, actions: ShortcutActions): boolean => {
  if (!(event.metaKey || event.ctrlKey)) return false;

  if (event.key === "k") {
    event.preventDefault();
    actions.toggleProjectSwitcher();
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
    actions.newProject();
    return true;
  }
  return false;
};
