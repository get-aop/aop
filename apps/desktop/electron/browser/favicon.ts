import { isWebUrl } from "./policy";

const MAX_FAVICON_BYTES = 128 * 1024;

export type FaviconFetch = (url: string) => Promise<Response>;

/**
 * A page's icon as a `data:` URL. The dashboard's content security policy loads images only from
 * itself and its host, so the app fetches the icon (through the browser's own session, with its
 * cookies) and hands over the bytes. Anything that is not a small image is dropped.
 */
export const faviconDataUrl = async (
  candidates: readonly string[],
  fetchIcon: FaviconFetch,
): Promise<string | null> => {
  for (const url of candidates) {
    if (url.startsWith("data:image/") && url.length <= MAX_FAVICON_BYTES * 2) return url;
    if (!isWebUrl(url)) continue;
    const icon = await fetchImage(url, fetchIcon);
    if (icon) return icon;
  }
  return null;
};

const fetchImage = async (url: string, fetchIcon: FaviconFetch): Promise<string | null> => {
  try {
    const response = await fetchIcon(url);
    const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_FAVICON_BYTES) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
};
