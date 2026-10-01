import { type FileHandle, open } from "node:fs/promises";

export interface LogReader {
  /** The text the log gained since the last read; empty when it gained none, or is missing. */
  read: () => Promise<string>;
  /** What is still held at the end: the start of a character the log never finished. */
  end: () => string;
}

/**
 * Reads a growing log as text, a piece at a time. A writer can stop in the middle of a
 * character's bytes (a token like "é" or an emoji split across two writes), so the decoder
 * keeps an unfinished character's first bytes until the rest arrives instead of garbling it.
 */
export const createLogReader = (path: string): LogReader => {
  let offset = 0;
  const decoder = new TextDecoder("utf-8");
  return {
    read: async () => {
      const bytes = await readAppendedBytes(path, offset);
      if (!bytes) return "";
      offset += bytes.length;
      return decoder.decode(bytes, { stream: true });
    },
    end: () => decoder.decode(),
  };
};

const readAppendedBytes = async (path: string, offset: number): Promise<Uint8Array | null> => {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "r");
    const stat = await handle.stat();
    if (stat.size <= offset) return null;
    const buffer = Buffer.alloc(stat.size - offset);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return bytesRead > 0 ? buffer.subarray(0, bytesRead) : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};
