import { sniffImageType } from "../attachment/image-type.ts";

/**
 * The type the Library stores a file as. The bytes win over the name where they can be read: a
 * file named `.png` that is not a PNG is not stored as an image. A name's type is trusted only
 * for text, which is served back as text; anything else unknown is `application/octet-stream`.
 */
export const libraryMimeType = (name: string, bytes: Uint8Array): string => {
  const image = sniffImageType(bytes);
  if (image) return image;
  if (startsWith(bytes, PDF)) return "application/pdf";
  const byName = TEXT_TYPES[extensionOf(name)];
  if (isText(bytes)) return byName ?? "text/plain";
  return "application/octet-stream";
};

/** Whether a stored type is text the host may hand an agent or a preview as a string. */
export const isTextType = (mimeType: string): boolean =>
  mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "image/svg+xml";

/**
 * What the content route sends a type as. Only raster images and PDFs go out as themselves;
 * markup (HTML, SVG) goes as plain text, so a file opened from its URL is never run as a page.
 */
export const servedContentType = (mimeType: string): string => {
  if (RASTER_IMAGES.has(mimeType) || mimeType === "application/pdf") return mimeType;
  if (isTextType(mimeType)) return "text/plain; charset=utf-8";
  return "application/octet-stream";
};

const RASTER_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const extensionOf = (name: string): string =>
  name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";

const TEXT_TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  svg: "image/svg+xml",
  xml: "text/xml",
};

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

// Text is valid UTF-8 with no NUL in what is checked; the first 64 KB decide.
const isText = (bytes: Uint8Array): boolean => {
  const head = bytes.subarray(0, 64 * 1024);
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      head.length < bytes.length ? trimPartialChar(head) : head,
    );
    return true;
  } catch {
    return false;
  }
};

// A cut at 64 KB can split a multi-byte character; drop its leading bytes before decoding.
const trimPartialChar = (head: Uint8Array): Uint8Array => {
  const end = head.length;
  for (let back = 1; back <= 3 && end - back >= 0; back++) {
    const byte = head[end - back] ?? 0;
    if ((byte & 0xc0) === 0xc0) return head.subarray(0, end - back);
    if ((byte & 0x80) === 0) break;
  }
  return head.subarray(0, end);
};
