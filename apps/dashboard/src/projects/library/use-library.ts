import type { LibraryItem, LibraryItemPatch, LibraryListing } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  deleteLibraryItem,
  getLibrary,
  updateLibraryItem,
  uploadLibraryFile,
} from "../../api/library";

/** How often an open Library looks for what agents and chats added meanwhile. */
export const LIBRARY_REFRESH_MS = 10_000;

export interface LibraryState {
  listing: LibraryListing | null;
  /** The first load failed; a later failure keeps the last listing on screen. */
  error: string | null;
  /** Files on their way to the host. */
  uploading: number;
  refresh: () => Promise<void>;
  upload: (files: readonly File[], folder?: string) => Promise<void>;
  update: (item: LibraryItem, patch: LibraryItemPatch) => Promise<boolean>;
  remove: (item: LibraryItem) => Promise<boolean>;
}

/**
 * A project's Library while its tab is open: loaded at once, refreshed every few seconds while
 * the window is visible, and after each change the person makes. Failures say why in a toast.
 */
export const useLibrary = (projectId: string): LibraryState => {
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const current = useRef(projectId);
  current.current = projectId;

  const refresh = useCallback(async () => {
    const id = projectId;
    try {
      const next = await getLibrary(id);
      if (current.current !== id) return;
      setListing(next);
      setError(null);
    } catch (cause) {
      if (current.current === id) setError(messageOf(cause));
    }
  }, [projectId]);

  useEffect(() => {
    setListing(null);
    setError(null);
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, LIBRARY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const upload = useCallback(
    async (files: readonly File[], folder?: string) => {
      setUploading((count) => count + files.length);
      let added = 0;
      for (const file of files) {
        if (await uploadOne(projectId, file, folder)) added++;
        setUploading((count) => count - 1);
      }
      if (added > 0) toast.success(added === 1 ? "Added 1 file" : `Added ${added} files`);
      await refresh();
    },
    [projectId, refresh],
  );

  const update = useCallback(
    async (item: LibraryItem, patch: LibraryItemPatch) => {
      try {
        await updateLibraryItem(projectId, item.id, patch);
        await refresh();
        return true;
      } catch (cause) {
        toast.error(messageOf(cause));
        return false;
      }
    },
    [projectId, refresh],
  );

  const remove = useCallback(
    async (item: LibraryItem) => {
      try {
        await deleteLibraryItem(projectId, item.id);
        toast.success(`Deleted ${item.name}`);
        await refresh();
        return true;
      } catch (cause) {
        toast.error(messageOf(cause));
        return false;
      }
    },
    [projectId, refresh],
  );

  return { listing, error, uploading, refresh, upload, update, remove };
};

const uploadOne = async (projectId: string, file: File, folder?: string): Promise<boolean> => {
  try {
    await uploadLibraryFile(projectId, file, folder);
    return true;
  } catch (cause) {
    toast.error(`${file.name} was not added: ${messageOf(cause)}`);
    return false;
  }
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error && cause.message ? cause.message : "Something went wrong";
