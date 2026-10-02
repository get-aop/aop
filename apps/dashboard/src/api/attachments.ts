import type { UploadedChatImage } from "@aop/common";
import { apiUrl, authHeaders, isRemoteHost } from "./host";
import { ApiError, request } from "./request";

/**
 * Sends an image to the project's host, to go with a message the person is writing. The body is
 * the file's own bytes, so it works the same from a browser, the desktop app and a remote host.
 */
export const uploadChatImage = async (projectId: string, file: Blob): Promise<UploadedChatImage> =>
  (
    await request<{ image: UploadedChatImage }>(
      `/projects/${encodeURIComponent(projectId)}/attachments`,
      {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      },
    )
  ).image;

const loaded = new Map<string, Promise<string>>();

/**
 * A URL an `<img>` can show for an image the host serves at `path` (under `/api`). An `<img>`
 * cannot send the bearer token the desktop app and a remote host use, so the image is fetched
 * like any API call and shown from memory. A sent image never changes, so each is fetched once.
 */
export const loadApiImage = (path: string): Promise<string> => {
  const cached = loaded.get(path);
  if (cached) return cached;
  const load = fetchImage(path);
  loaded.set(path, load);
  // A failed fetch is forgotten, so the next attempt asks again.
  load.catch(() => loaded.delete(path));
  return load;
};

const fetchImage = async (path: string): Promise<string> => {
  const response = await fetch(apiUrl(path), {
    credentials: isRemoteHost() ? "include" : "same-origin",
    headers: authHeaders(),
  });
  if (!response.ok) {
    // 410 is an image the Library removed (retention, or the person); its body says which.
    const body = (await response.json().catch(() => ({}))) as { code?: string; reason?: string };
    throw new ApiError(
      response.status,
      body.code ?? "IMAGE_FAILED",
      body.reason ?? `Image request failed (${response.status})`,
    );
  }
  return URL.createObjectURL(await response.blob());
};
