import { chmod, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { normalizeReleaseVersion, type ReleaseInfo } from "@aop/common";
import { downloadAsset, verifyChecksum } from "./download.ts";
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
 * Downloads the host binary and the dashboard for `release`, checks both against the release's
 * `checksums.sha256`, and proves the binary runs and is the release it claims to be. It stages
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
  const binaryName = hostAssetName(platform);
  const checksumsFile = join(dir, CHECKSUMS_NAME);
  await downloadNamed(release, CHECKSUMS_NAME, checksumsFile, tools.fetch);
  const checksums = await Bun.file(checksumsFile).text();

  const binary = join(dir, binaryName);
  const archive = join(dir, RUNTIME_ASSETS_NAME);
  await downloadNamed(release, binaryName, binary, tools.fetch);
  await verifyChecksum(checksums, binaryName, binary);
  await downloadNamed(release, RUNTIME_ASSETS_NAME, archive, tools.fetch);
  await verifyChecksum(checksums, RUNTIME_ASSETS_NAME, archive);

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

const downloadNamed = async (
  release: ReleaseInfo,
  name: string,
  path: string,
  fetchFn: FetchFn,
): Promise<void> => {
  const url = release.assets[name];
  if (!url) throw new Error(`Release ${release.version} has no ${name}`);
  await downloadAsset(name, url, path, fetchFn);
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
  // cac prints `aop/<version> <platform> <runtime>`.
  const reported = printed.match(/^aop\/(\S+)/)?.[1] ?? printed;
  if (normalizeReleaseVersion(reported) !== version) {
    throw new Error(`The downloaded host reports version "${printed}", not ${version}`);
  }
};
