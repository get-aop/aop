import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonFile<T> {
  read: () => Promise<T>;
  write: (value: T) => Promise<void>;
}

/**
 * One small JSON document on disk. A missing or unreadable file reads as `fallback`, so a
 * first run and a damaged file are the same case. A write goes to a temporary file that is then
 * renamed over the real one, so a crash never leaves half a document. Only the owner can read it.
 */
export const createJsonFile = <T>(
  path: string,
  parse: (raw: unknown) => T,
  fallback: () => T,
): JsonFile<T> => ({
  read: async () => {
    try {
      return parse(JSON.parse(await readFile(path, "utf8")));
    } catch {
      return fallback();
    }
  },
  write: async (value) => {
    await mkdir(dirname(path), { recursive: true });
    const staging = `${path}.${process.pid}.tmp`;
    await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(staging, path);
  },
});
