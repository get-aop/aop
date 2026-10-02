import type { MenuItemConstructorOptions } from "electron";
import { isWebUrl } from "./policy";

/** The part of Electron's `ContextMenuParams` the menus are built from. */
export interface ContextMenuInput {
  linkURL: string;
  srcURL: string;
  mediaType: string;
  isEditable: boolean;
  selectionText: string;
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

export interface PageMenuActions {
  canGoBack: boolean;
  canGoForward: boolean;
  back: () => void;
  forward: () => void;
  reload: () => void;
  openInNewTab: (url: string) => void;
  copyText: (text: string) => void;
  copyImage: () => void;
  inspect: () => void;
}

/** A right click in a page: what Chrome offers, short of extensions and translation. */
export const pageContextMenu = (
  input: ContextMenuInput,
  actions: PageMenuActions,
): MenuItemConstructorOptions[] => {
  const groups: MenuItemConstructorOptions[][] = [];
  if (isWebUrl(input.linkURL)) {
    groups.push([
      { label: "Open Link in New Tab", click: () => actions.openInNewTab(input.linkURL) },
      { label: "Copy Link Address", click: () => actions.copyText(input.linkURL) },
    ]);
  }
  if (input.mediaType === "image" && input.srcURL) {
    groups.push([
      { label: "Open Image in New Tab", click: () => actions.openInNewTab(input.srcURL) },
      { label: "Copy Image", click: actions.copyImage },
    ]);
  }
  const editing = editingItems(input);
  if (editing.length > 0) groups.push(editing);
  else {
    groups.push([
      { label: "Back", enabled: actions.canGoBack, click: actions.back },
      { label: "Forward", enabled: actions.canGoForward, click: actions.forward },
      { label: "Reload", click: actions.reload },
    ]);
  }
  groups.push([{ label: "Inspect", click: actions.inspect }]);
  return joinGroups(groups);
};

export interface WindowMenuActions {
  openInBrowser: (url: string) => void;
  openExternal: (url: string) => void;
  copyText: (text: string) => void;
}

/**
 * A right click in the app's own window. A web link may open in the AOP Browser, which is how a
 * thread's localhost link (a dev server, a test stack's dashboard) gets there; a plain click still
 * opens the person's own browser. Text fields get the usual editing items.
 */
export const windowContextMenu = (
  input: ContextMenuInput,
  actions: WindowMenuActions,
): MenuItemConstructorOptions[] => {
  const groups: MenuItemConstructorOptions[][] = [];
  if (isWebUrl(input.linkURL)) {
    groups.push([
      { label: "Open in AOP Browser", click: () => actions.openInBrowser(input.linkURL) },
      { label: "Open in Default Browser", click: () => actions.openExternal(input.linkURL) },
      { label: "Copy Link", click: () => actions.copyText(input.linkURL) },
    ]);
  }
  const editing = editingItems(input);
  if (editing.length > 0) groups.push(editing);
  return joinGroups(groups);
};

const editingItems = (input: ContextMenuInput): MenuItemConstructorOptions[] => {
  if (input.isEditable) {
    return [
      { role: "cut", enabled: input.editFlags.canCut },
      { role: "copy", enabled: input.editFlags.canCopy },
      { role: "paste", enabled: input.editFlags.canPaste },
      { role: "selectAll", enabled: input.editFlags.canSelectAll },
    ];
  }
  return input.selectionText.trim() ? [{ role: "copy" }] : [];
};

const joinGroups = (groups: MenuItemConstructorOptions[][]): MenuItemConstructorOptions[] =>
  groups.flatMap((group, index) =>
    index === 0 ? group : [{ type: "separator" as const }, ...group],
  );
