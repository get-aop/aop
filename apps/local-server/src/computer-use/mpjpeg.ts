/**
 * Splits ffmpeg's `mpjpeg` output into JPEG frames. Each part is
 * `--ffmpeg\r\nContent-type: image/jpeg\r\nContent-length: <n>\r\n\r\n<n bytes>\r\n`; the length
 * header is what makes this exact (scanning JPEG bytes for markers is not). Chunks may cut a part
 * anywhere, so bytes wait in a buffer until a whole part is in.
 */
export const createMpjpegParser = (onFrame: (jpeg: Uint8Array) => void) => {
  let buffer: Uint8Array = new Uint8Array(0);

  const drain = () => {
    let part = nextPart(buffer);
    while (part) {
      if (part.jpeg) onFrame(part.jpeg);
      buffer = part.rest;
      part = nextPart(buffer);
    }
  };

  return {
    push: (chunk: Uint8Array) => {
      const next = new Uint8Array(buffer.length + chunk.length);
      next.set(buffer);
      next.set(chunk, buffer.length);
      buffer = next;
      drain();
    },
  };
};

/**
 * The first whole part in `buffer` and what follows it, or null until one is in. A part whose
 * header has no length is skipped (no `jpeg`), so the stream can recover.
 */
const nextPart = (buffer: Uint8Array): { jpeg?: Uint8Array; rest: Uint8Array } | null => {
  const headerEnd = indexOf(buffer, HEADER_END);
  if (headerEnd < 0) return null;
  const length = contentLength(DECODER.decode(buffer.subarray(0, headerEnd)));
  const start = headerEnd + HEADER_END.length;
  if (length === null) return { rest: buffer.subarray(start) };
  if (buffer.length < start + length) return null;
  return { jpeg: buffer.slice(start, start + length), rest: buffer.subarray(start + length) };
};

const DECODER = new TextDecoder();
const HEADER_END = new TextEncoder().encode("\r\n\r\n");

const contentLength = (header: string): number | null => {
  const match = header.match(/content-length:\s*(\d+)/i);
  return match?.[1] ? Number(match[1]) : null;
};

const indexOf = (haystack: Uint8Array, needle: Uint8Array): number => {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
};
