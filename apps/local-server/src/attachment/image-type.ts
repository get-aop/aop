import type { ChatImageMimeType } from "@aop/common";

/**
 * The image type a file's own bytes say it is, or null for anything else. The upload's declared
 * type is not trusted: a file named or labelled as a PNG that is really HTML or SVG must never be
 * stored and served back as an image.
 */
export const sniffImageType = (bytes: Uint8Array): ChatImageMimeType | null => {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return "image/gif";
  if (startsWith(bytes, RIFF) && startsWith(bytes.subarray(8), WEBP)) return "image/webp";
  return null;
};

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
