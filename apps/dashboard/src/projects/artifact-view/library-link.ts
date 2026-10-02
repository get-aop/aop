/**
 * "Open in Library": the Library tab registers how it shows one of its items, so the view needs
 * nothing of the tab's own. Until it has, the button is not offered.
 */
type LibraryOpener = (target: { projectId: string; itemId: string }) => void;

let opener: LibraryOpener | null = null;

export const registerLibraryOpener = (open: LibraryOpener): (() => void) => {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
};

export const canOpenInLibrary = (): boolean => opener !== null;

export const openInLibrary = (projectId: string, itemId: string): void => {
  opener?.({ projectId, itemId });
};
