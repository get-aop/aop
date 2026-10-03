import { chmod, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { normalizeReleaseVersion, type ReleaseInfo } from "@aop/common";
import { digestInChecksums, downloadAsset, verifyDigest } from "./download.ts";
import { type HostPlatform, hostAssetName, type InstallLayout } from "./install-layout.ts";
import { CHECKSUMS_NAME, type FetchFn, messageOf, RUNTIME_ASSETS_NAME } from "./release-feed.ts";

/** A release downloaded, checked and unpacked beside the install, not yet in place. */
export interface StagedRelease {
  dir: string;
  binary: string;
  dashboard: string;
}

/** The things staging does to the machine, so a test can stand in for them. */
export interface StageTools {
  fetch: FetchFn;
  /** Unpacks a `.tar.gz` into an existing folder. */
  extract: (archive: string, into: string) => Promise<void>;
  /** Gives the binary a signature the OS will run. */
  signBinary: (path: string) => Promise<void>;
  /** What the binary prints for `--version`; the proof that it runs at all. */
  probeVersion: (binary: string) => Promise<string>;
}

/**
 * Downloads the host binary and the dashboard for `release`, checks both against the sha256 the
 * feed lists for them (or, for a source that lists none, the release's `checksums.sha256`), and
 * proves the binary runs and is the release it claims to be. It stages
 * next to the install (same filesystem, so the swap is a rename); nothing in the install
 * changes here, and the staging folder is removed when this throws.
 */
export const stageRelease = async (
  release: ReleaseInfo,
  platform: HostPlatform,
  layout: InstallLayout,
  tools: StageTools,
): Promise<StagedRelease> => {
  const dir = await makeStagingDir(layout);
  try {
    return await fill(dir, release, platform, tools);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
};

/** The files of a release this host runs from: its own binary and the runtime assets. */
export const hostReleaseFiles = (platform: HostPlatform): string[] => [
  hostAssetName(platform),
  RUNTIME_ASSETS_NAME,
];

/**
 * Downloads each of `names` into `dir` and checks it against the sha256 the feed lists for it
 * (or, for a source that lists none, the release's `checksums.sha256`). A file that fails the
 * check is deleted, and this throws.
 */
export const downloadVerified = async (
  release: ReleaseInfo,
  names: string[],
  dir: string,
  fetchFn: FetchFn,
): Promise<void> => {
  const expected = await expectedDigests(release, names, dir, fetchFn);
  for (const name of names) {
    const path = join(dir, name);
    await downloadNamed(release, name, path, fetchFn);
    await verifyDigest(name, path, expected.get(name) ?? null);
  }
};

const makeStagingDir = async (layout: InstallLayout): Promise<string> => {
  try {
    return await mkdtemp(join(layout.installDir, ".aop-update-"));
  } catch (error) {
    throw new Error(
      `Cannot write to ${layout.installDir}: ${messageOf(error)}. Run the installer again from an account that owns it.`,
    );
  }
};

const fill = async (
  dir: string,
  release: ReleaseInfo,
  platform: HostPlatform,
  tools: StageTools,
): Promise<StagedRelease> => {
  await downloadVerified(release, hostReleaseFiles(platform), dir, tools.fetch);

  const binary = join(dir, hostAssetName(platform));
  const archive = join(dir, RUNTIME_ASSETS_NAME);

  const unpacked = join(dir, "unpacked");
  await tools.extract(archive, unpacked);
  const dashboard = join(dir, "dashboard");
  await rename(join(unpacked, "dashboard"), dashboard).catch(() => {
    throw new Error("The release's runtime assets did not contain a dashboard");
  });
  await requireFile(join(dashboard, "index.html"), "dashboard/index.html");

  await chmod(binary, 0o755);
  await tools.signBinary(binary);
  await requireRelease(binary, release.version, tools.probeVersion);
  return { dir, binary, dashboard };
};

// The feed lists every file's sha256; GitHub does not, so that source needs checksums.sha256.
const expectedDigests = async (
  release: ReleaseInfo,
  names: string[],
  dir: string,
  fetchFn: FetchFn,
): Promise<Map<string, string | null>> => {
  const listed = new Map(names.map((name) => [name, release.assets[name]?.sha256 ?? null]));
  if ([...listed.values()].every(Boolean)) return listed;
  const checksumsFile = join(dir, CHECKSUMS_NAME);
  await downloadNamed(release, CHECKSUMS_NAME, checksumsFile, fetchFn);
  const checksums = await Bun.file(checksumsFile).text();
  for (const [name, digest] of listed) {
    listed.set(name, digest ?? digestInChecksums(checksums, name));
  }
  return listed;
};

const downloadNamed = async (
  release: ReleaseInfo,
  name: string,
  path: string,
  fetchFn: FetchFn,
): Promise<void> => {
  const asset = release.assets[name];
  if (!asset) throw new Error(`Release ${release.version} has no ${name}`);
  await downloadAsset(name, asset, path, fetchFn);
};

const requireFile = async (path: string, label: string): Promise<void> => {
  const found = await stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
  if (!found) throw new Error(`The release's runtime assets are missing ${label}`);
};

const requireRelease = async (
  binary: string,
  version: string,
  probeVersion: StageTools["probeVersion"],
): Promise<void> => {
  let printed: string;
  try {
    printed = await probeVersion(binary);
  } catch (error) {
    throw new Error(`The downloaded host does not run: ${messageOf(error)}`);
  }
  // cac prints `<name>/<version> <platform> <runtime>`: `aop/…`, or `aop-nightly/…` for AOP Nightly.
  const reported = printed.match(/^aop(?:-nightly)?\/(\S+)/)?.[1] ?? printed;
  if (normalizeReleaseVersion(reported) !== version) {
    throw new Error(`The downloaded host reports version "${printed}", not ${version}`);
  }
};
