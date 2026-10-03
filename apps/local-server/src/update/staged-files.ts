import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReleaseInfo } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { FetchFn } from "./release-feed.ts";

// Releases downloaded ahead of time (background-download.ts) wait under the host's data folder,
// `update-staged/<version>/`, with a `staged.json` naming the files once every one is in and
// checked. Nothing in the install changes; `aop update` (update-host.ts) takes the files from
// here instead of the network and checks them again before it swaps anything.

const MANIFEST = "staged.json";

interface StagedManifest {
  version: string;
  files: string[];
}

/** Where staged releases live: one folder per version. */
export const stagedReleasesDir = (home: string = aopPaths.home()): string =>
  join(home, "update-staged");

/** The staged release `version`, when every file it lists is still there; else null. */
export const readStagedRelease = async (
  root: string,
  version: string,
): Promise<StagedManifest | null> => {
  const dir = join(root, version);
  try {
    const manifest = JSON.parse(await Bun.file(join(dir, MANIFEST)).text()) as StagedManifest;
    if (manifest.version !== version || !Array.isArray(manifest.files)) return null;
    const present = await Promise.all(manifest.files.map((name) => isFile(join(dir, name))));
    return present.every(Boolean) ? manifest : null;
  } catch {
    return null;
  }
};

/** The versions staged in full. */
export const listStagedReleases = async (root: string): Promise<string[]> => {
  const entries = await readdir(root).catch(() => [] as string[]);
  const versions = entries.filter((entry) => !entry.startsWith("."));
  const staged = await Promise.all(versions.map((version) => readStagedRelease(root, version)));
  return versions.filter((_, index) => staged[index] !== null);
};

/** Puts a fully downloaded and checked `partial` folder in place as `version`. */
export const commitStagedRelease = async (
  root: string,
  version: string,
  partial: string,
): Promise<void> => {
  const files = (await readdir(partial)).filter((name) => name !== MANIFEST);
  await writeFile(join(partial, MANIFEST), JSON.stringify({ version, files }));
  await rm(join(root, version), { recursive: true, force: true });
  await rename(partial, join(root, version));
};

/** Removes every staged release but `keep`, and any download left half done. */
export const pruneStagedReleases = async (root: string, keep: string | null): Promise<void> => {
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root)) {
    if (entry !== keep) await rm(join(root, entry), { recursive: true, force: true });
  }
};

/**
 * A fetch that answers the asset addresses of `release` from its staged files, and anything
 * else from the network; null when nothing of `release` is staged. What it serves is checked
 * against the feed's sha256 as a download would be.
 */
export const stagedFetch = async (
  release: ReleaseInfo,
  root: string,
  fetchFn: FetchFn,
): Promise<FetchFn | null> => {
  const staged = await readStagedRelease(root, release.version);
  if (!staged) return null;
  const local = new Map<string, string>();
  for (const name of staged.files) {
    const asset = release.assets[name];
    if (asset) local.set(asset.url, join(root, release.version, name));
  }
  return async (input, init) => {
    const path = local.get(input);
    return path ? new Response(Bun.file(path)) : fetchFn(input, init);
  };
};

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
