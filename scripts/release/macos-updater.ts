#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release CLI reports progress to the operator

import { basename, join } from "node:path";
import cac from "cac";

export const MAC_ARCHES = ["x64", "arm64"] as const;
export type MacArch = (typeof MAC_ARCHES)[number];

/** What electron-updater on macOS reads from getaop.com/latest/ (release-feed.ts makes that copy). */
export const MAC_UPDATER_CONFIG = "latest-mac.yml";

/** Squirrel.Mac installs a zip of the signed app, never the DMG. */
export const macUpdateZipName = (arch: MacArch): string => `aop-macos-${arch}.zip`;

/**
 * What the installed macOS app updates itself from: one zip per architecture and the
 * `latest-mac.yml` naming both. Each architecture is its own Electron Builder run, and each run
 * writes a `latest-mac.yml` naming only its own files, so the one that ships is written here once
 * both zips exist. electron-updater picks the zip whose name says arm64 on Apple silicon and the
 * other one on Intel.
 */
export const MAC_UPDATER_FILES = [MAC_UPDATER_CONFIG, ...MAC_ARCHES.map(macUpdateZipName)];

export interface UpdateZip {
  name: string;
  /** Base64, as electron-updater compares it. */
  sha512: string;
  size: number;
}

export const buildLatestMacYml = (
  version: string,
  zips: UpdateZip[],
  releaseDate: string,
): string => {
  const [first] = zips;
  if (!first) throw new Error(`${MAC_UPDATER_CONFIG} needs at least one zip`);
  const files = zips.flatMap((zip) => [
    `  - url: ${zip.name}`,
    `    sha512: ${zip.sha512}`,
    `    size: ${zip.size}`,
  ]);
  return [
    `version: ${version}`,
    "files:",
    ...files,
    `path: ${first.name}`,
    `sha512: ${first.sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n");
};

/** Writes `latest-mac.yml` into `releaseDir` from the zips already there. */
export const writeLatestMacYml = async (
  releaseDir: string,
  version: string,
  releaseDate: string = new Date().toISOString(),
): Promise<string> => {
  const zips: UpdateZip[] = [];
  for (const arch of MAC_ARCHES)
    zips.push(await describeZip(join(releaseDir, macUpdateZipName(arch))));
  const path = join(releaseDir, MAC_UPDATER_CONFIG);
  await Bun.write(path, buildLatestMacYml(version, zips, releaseDate));
  return path;
};

/**
 * Fails unless `latest-mac.yml` in `releaseDir` is for `version` and names every zip with the
 * hash and size the zip in this run has. A wrong one strands every installed app: it either finds
 * no update or downloads a file that fails its own check.
 */
export const checkLatestMacYml = async (releaseDir: string, version: string): Promise<void> => {
  const file = Bun.file(join(releaseDir, MAC_UPDATER_CONFIG));
  if (!(await file.exists())) throw new Error(`${MAC_UPDATER_CONFIG} is missing`);
  const parsed = Bun.YAML.parse(await file.text()) as {
    version?: unknown;
    files?: Array<{ url?: unknown; sha512?: unknown; size?: unknown }>;
  };
  if (String(parsed.version) !== version) {
    throw new Error(`${MAC_UPDATER_CONFIG} is for ${String(parsed.version)}, not ${version}`);
  }
  for (const arch of MAC_ARCHES) {
    const zip = await describeZip(join(releaseDir, macUpdateZipName(arch)));
    const listed = (parsed.files ?? []).find((entry) => entry.url === zip.name);
    if (!listed) throw new Error(`${MAC_UPDATER_CONFIG} does not list ${zip.name}`);
    if (listed.sha512 !== zip.sha512 || Number(listed.size) !== zip.size) {
      throw new Error(`${MAC_UPDATER_CONFIG} does not match ${zip.name} in this run`);
    }
  }
};

const describeZip = async (path: string): Promise<UpdateZip> => {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Missing macOS update zip: ${path}`);
  const hasher = new Bun.CryptoHasher("sha512");
  for await (const chunk of file.stream()) hasher.update(chunk);
  return { name: basename(path), sha512: hasher.digest("base64"), size: file.size };
};

const main = async (): Promise<void> => {
  const cli = cac("macos-updater");
  cli
    .command("check", `Check ${MAC_UPDATER_CONFIG} against the zips in the release folder`)
    .option("--dir <path>", "The release folder", { default: "dist/release" })
    .option("--version <version>", "The release version, x.y.z")
    .action(async (options: { dir: string; version?: string }) => {
      if (!options.version) throw new Error("Usage: macos-updater.ts check --version <x.y.z>");
      const dir = String(options.dir);
      console.log(await Bun.file(join(dir, MAC_UPDATER_CONFIG)).text());
      await checkLatestMacYml(dir, String(options.version));
      console.log(`${MAC_UPDATER_CONFIG} matches the macOS update zips of ${options.version}`);
    });
  cli.help();
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
