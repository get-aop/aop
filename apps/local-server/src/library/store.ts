import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";

/**
 * Where a project's Library keeps the files it owns: one file per distinct content under
 * `library/blobs/<sha256>`, so items with the same bytes share it. The directory goes with the
 * project. Chat attachments are not here; they stay with their message.
 */
export const libraryDir = (projectId: string): string =>
  join(aopPaths.projectDir(projectId), "library");

const blobsDir = (projectId: string): string => join(libraryDir(projectId), "blobs");

const SHA256 = /^[0-9a-f]{64}$/;

export const blobPath = (projectId: string, sha256: string): string => {
  // The name is the host's own hash, never a client's; checked so no caller can make it a path.
  if (!SHA256.test(sha256)) throw new Error(`Not a sha256: ${sha256}`);
  return join(blobsDir(projectId), sha256);
};

export const sha256Of = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/**
 * Stores `bytes` under their hash, unless the same content is there already. Written to a
 * temporary name and renamed, so a crash never leaves a partial file under a content's name.
 */
export const putBlob = async (
  projectId: string,
  bytes: Uint8Array,
): Promise<{ sha256: string; size: number }> => {
  const sha256 = sha256Of(bytes);
  const path = blobPath(projectId, sha256);
  if (!(await Bun.file(path).exists())) {
    await mkdir(blobsDir(projectId), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await Bun.write(temporary, bytes);
    await rename(temporary, path);
  }
  return { sha256, size: bytes.length };
};

export const removeBlob = (projectId: string, sha256: string): Promise<void> =>
  rm(blobPath(projectId, sha256), { force: true });

export interface StoredBlob {
  sha256: string;
  /** Last modified, so a sweep leaves alone what a save is about to index. */
  mtimeMs: number;
}

/** The blobs on disk, and leftovers of interrupted writes (named `*.tmp`) as `sha256: null`. */
export const listBlobs = async (
  projectId: string,
): Promise<(StoredBlob | { sha256: null; name: string; mtimeMs: number })[]> => {
  const dir = blobsDir(projectId);
  const names = await readdir(dir).catch(() => [] as string[]);
  const blobs = [];
  for (const name of names) {
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info?.isFile()) continue;
    blobs.push(
      SHA256.test(name)
        ? { sha256: name, mtimeMs: info.mtimeMs }
        : { sha256: null, name, mtimeMs: info.mtimeMs },
    );
  }
  return blobs;
};

export const removeBlobLeftover = (projectId: string, name: string): Promise<void> =>
  rm(join(blobsDir(projectId), name), { force: true });

const locks = new Map<string, Promise<unknown>>();

/**
 * Runs `work` alone among the project's Library writes: a save and the cleanup must not both
 * decide whether a blob is still used. Never call it inside a database transaction; the cleanup
 * holds it while it queries.
 */
export const withLibraryLock = async <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
  const previous = locks.get(projectId) ?? Promise.resolve();
  const run = previous.then(work, work);
  const settled = run.catch(() => undefined);
  locks.set(projectId, settled);
  try {
    return await run;
  } finally {
    if (locks.get(projectId) === settled) locks.delete(projectId);
  }
};
