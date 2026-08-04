#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: local release CLI reports progress to the operator

import { join } from "node:path";
import { resolvePresentReleaseArtifacts } from "./checksums.ts";

const RELEASE_DIR = process.env.RELEASE_DIR ?? "dist/release";
const CHECKSUMS_FILE = "checksums.sha256";

/**
 * Release artifacts present on disk plus the checksums manifest. resolvePresentReleaseArtifacts
 * intentionally omits checksums.sha256 (it lists the files that get hashed, not the hash file),
 * so attach it separately or the published release ships without the manifest install.sh verifies.
 */
const resolveReleaseAssets = async (releaseDir: string): Promise<string[]> => {
  const assets = await resolvePresentReleaseArtifacts(releaseDir);
  const checksums = join(releaseDir, CHECKSUMS_FILE);
  if (await Bun.file(checksums).exists()) {
    assets.push(checksums);
  }
  return assets;
};

/**
 * Build the `gh release create` argument vector. Artifacts are resolved from disk
 * at execution time (resolvePresentReleaseArtifacts) rather than hardcoded, so a
 * partial local build (e.g. macOS host with no Windows installer) still publishes
 * cleanly instead of failing on a missing file.
 */
export const buildGhReleaseArgs = (tag: string, repo: string, artifacts: string[]): string[] => [
  "release",
  "create",
  tag,
  "--repo",
  repo,
  "--title",
  `AOP ${tag}`,
  "--generate-notes",
  ...artifacts,
];

/**
 * Build the `gh release upload` argument vector for an existing release. `--clobber`
 * overwrites same-named assets, so a second host (the official process builds the
 * macOS DMG and the Windows installer on different machines) can attach its own
 * installer to the release another host already created.
 */
export const buildGhUploadArgs = (tag: string, repo: string, artifacts: string[]): string[] => [
  "release",
  "upload",
  tag,
  "--repo",
  repo,
  "--clobber",
  ...artifacts,
];

const releaseExists = async (tag: string, repo: string): Promise<boolean> => {
  const proc = Bun.spawn(["gh", "release", "view", tag, "--repo", repo], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
};

const run = async (args: string[]): Promise<void> => {
  const proc = Bun.spawn(["gh", ...args], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
};

const main = async (): Promise<void> => {
  const [tag, repo] = process.argv.slice(2);
  if (!tag || !repo) {
    console.error("Usage: gh-release.ts <tag> <repo>");
    process.exit(1);
  }

  const artifacts = await resolveReleaseAssets(RELEASE_DIR);
  if (await releaseExists(tag, repo)) {
    console.log(`Updating GitHub release ${tag} with ${artifacts.length} artifact(s)`);
    await run(buildGhUploadArgs(tag, repo, artifacts));
  } else {
    console.log(`Creating GitHub release ${tag} with ${artifacts.length} artifact(s)`);
    await run(buildGhReleaseArgs(tag, repo, artifacts));
  }
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
