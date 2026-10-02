import type { LibraryItem, LibraryItemPatch, LibraryListing, LibrarySettings } from "@aop/common";
import { apiUrl, authHeaders, isRemoteHost } from "./host";
import { ApiError, request } from "./request";

const libraryPath = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}/library`;

const itemPath = (projectId: string, itemId: string): string =>
  `${libraryPath(projectId)}/items/${encodeURIComponent(itemId)}`;

/** The project's files, its storage and the retention that applies to it. */
export const getLibrary = (projectId: string): Promise<LibraryListing> =>
  request<LibraryListing>(libraryPath(projectId));

/**
 * Adds a file the person chose or dropped. The body is the file's own bytes and its name rides
 * in a header, as chat images do, so a browser, the desktop app and a remote host send it alike.
 */
export const uploadLibraryFile = async (
  projectId: string,
  file: File,
  folder?: string,
): Promise<LibraryItem> => {
  const query = folder ? `?folder=${encodeURIComponent(folder)}` : "";
  return (
    await request<{ item: LibraryItem }>(`${libraryPath(projectId)}${query}`, {
      method: "POST",
      body: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
    })
  ).item;
};

export const updateLibraryItem = async (
  projectId: string,
  itemId: string,
  patch: LibraryItemPatch,
): Promise<LibraryItem> =>
  (
    await request<{ item: LibraryItem }>(itemPath(projectId, itemId), {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  ).item;

export const deleteLibraryItem = async (projectId: string, itemId: string): Promise<void> => {
  await request<unknown>(itemPath(projectId, itemId), { method: "DELETE" });
};

export const setLibrarySettings = (
  projectId: string,
  settings: LibrarySettings,
): Promise<LibraryListing> =>
  request<LibraryListing>(`${libraryPath(projectId)}/settings`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });

/** Where an item's bytes are served, under `/api`. */
export const libraryContentPath = (projectId: string, itemId: string): string =>
  `${itemPath(projectId, itemId)}/content`;

/**
 * An item's bytes, fetched with this client's credentials: an `<img>` or a download link cannot
 * send the bearer token the desktop app and a remote host use.
 */
export const fetchLibraryContent = async (projectId: string, itemId: string): Promise<Blob> => {
  const response = await fetch(apiUrl(libraryContentPath(projectId, itemId)), {
    cache: "no-store",
    credentials: isRemoteHost() ? "include" : "same-origin",
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      "CONTENT_FAILED",
      `Could not load the file (${response.status})`,
    );
  }
  return response.blob();
};

/** Saves an item to the person's disk under its name. */
export const downloadLibraryItem = async (projectId: string, item: LibraryItem): Promise<void> => {
  const url = URL.createObjectURL(await fetchLibraryContent(projectId, item.id));
  const link = document.createElement("a");
  link.href = url;
  link.download = item.name;
  document.body.append(link);
  link.click();
  link.remove();
  // The click has handed the blob to the download by now; give it a moment before letting go.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
