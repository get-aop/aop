#!/usr/bin/env bun
import { basename, isAbsolute, join, resolve } from "node:path";

const MAC_ARCHES = ["x64", "arm64"] as const;

/**
 * The full set of release artifacts the central release job checksums. This is the single
 * source of truth for what ships in checksums.sha256 — the build/package jobs must not
 * write the authoritative file. Missing files are skipped (resolvePresentReleaseArtifacts),
 * so partial local builds still produce a valid manifest.
 */
export const RELEASE_CHECKSUM_ARTIFACTS = [
  "runtime-assets.tar.gz",
  "aop-linux-x64",
  "aop-linux-arm64",
  "aop-darwin-x64",
  "aop-darwin-arm64",
  "aop-windows-x64.exe",
  ...MAC_ARCHES.map((arch) => `aop-macos-${arch}.dmg`),
  "aop-windows-x64-setup.exe",
];

export const generateChecksumFile = async (
  files: string[],
  checksumPath: string,
): Promise<void> => {
  const lines = await buildChecksumLines(files);
  await Bun.write(checksumPath, `${lines.join("\n")}\n`);
};

const buildChecksumLines = async (files: string[]): Promise<string[]> => {
  const lines: string[] = [];

  for (const filepath of files) {
    const data = await Bun.file(filepath).arrayBuffer();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(data);
    lines.push(`${hasher.digest("hex")}  ${basename(filepath)}`);
  }

  return lines;
};

/** Absolute paths of the release artifacts that are actually present on disk. */
export const resolvePresentReleaseArtifacts = async (releaseDir: string): Promise<string[]> => {
  const artifacts: string[] = [];

  for (const name of RELEASE_CHECKSUM_ARTIFACTS) {
    const path = join(releaseDir, name);
    if (await Bun.file(path).exists()) {
      artifacts.push(path);
    }
  }

  return artifacts;
};

/** Generate the single checksums.sha256 over every present artifact in releaseDir. */
export const generateReleaseChecksums = async (releaseDir: string): Promise<string[]> => {
  const resolved = isAbsolute(releaseDir) ? releaseDir : resolve(releaseDir);
  const inputs = await resolvePresentReleaseArtifacts(resolved);
  await generateChecksumFile(inputs, join(resolved, "checksums.sha256"));
  return inputs;
};

const main = async (): Promise<void> => {
  const releaseDir = process.argv[2] ?? "dist/release";
  const inputs = await generateReleaseChecksums(releaseDir);
  // biome-ignore lint/suspicious/noConsole: release CLI reports progress to the operator
  console.log(`Wrote checksums.sha256 over ${inputs.length} artifact(s) in ${releaseDir}`);
};

if (import.meta.main) {
  main().catch((error) => {
    // biome-ignore lint/suspicious/noConsole: release CLI reports failures to the operator
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
