#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release CLI reports progress to the operator

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CHANNELS,
  CUA_DRIVER_VERSION,
  describeReleaseFile,
  latestReleaseApiUrl,
  parseReleaseChannel,
  RELEASE_FEED_ORIGIN,
  type ReleaseChannel,
  type ReleaseFeed,
  type ReleaseFeedFile,
  releaseNotesUrl,
} from "@aop/common";
import cac from "cac";
import { RELEASE_CHECKSUM_ARTIFACTS } from "./checksums.ts";
import { MAC_UPDATER_CONFIG } from "./macos-updater.ts";

const CHECKSUMS_NAME = "checksums.sha256";
const WINDOWS_UPDATER_CONFIG = "latest.yml";
// The repository AOP 0.10.0 to 0.10.4 were built against. Their path is frozen into those
// binaries, so it stays when the repository moves.
const LEGACY_RELEASE_REPO = "get-aop/aop-mono";

export interface FeedInput {
  releaseDir: string;
  version: string;
  /** Markdown; empty when the notes could not be generated. */
  notes: string;
  publishedAt: string;
  /** The public origin the files are served from, `https://getaop.com`. */
  origin?: string;
  /**
   * `nightly` describes an AOP Nightly build (docs/NIGHTLY.md): it carries its channel and
   * commit, and has no GitHub-shaped copy, because no nightly is a GitHub release.
   */
  channel?: ReleaseChannel;
  /** The commit the build was made from. */
  commit?: string;
  /**
   * The CUA Driver version the release pins; this checkout's `CUA_DRIVER_VERSION`, which is the
   * release's own. A fake feed names another to show a host update that brings a new driver.
   */
  cuaDriver?: string;
}

/**
 * Every feed document of one release, keyed by its path in the bucket (and on getaop.com). The
 * versioned ones never change; `releases/latest.json`, the GitHub-shaped copy and the desktop
 * apps' `latest/latest.yml` (Windows) and `latest/latest-mac.yml` (macOS) are the pointers
 * deploy-r2.sh flips last.
 */
export interface FeedDocuments {
  versioned: Record<string, string>;
  pointers: Record<string, string>;
}

/**
 * Describes the release in `releaseDir` for the updaters: its version, notes and every file with
 * its public URL, sha256 and size. The digests come from checksums.sha256 and are checked against
 * the files themselves, so the feed can never promise a digest the published file does not have.
 */
export const buildReleaseFeed = async (input: FeedInput): Promise<ReleaseFeed> => {
  const origin = (input.origin ?? RELEASE_FEED_ORIGIN).replace(/\/+$/, "");
  return {
    schemaVersion: 1,
    version: input.version,
    publishedAt: input.publishedAt,
    notes: input.notes,
    notesUrl: releaseNotesUrl(input.version, origin),
    files: await describeReleaseFiles(input.releaseDir, `${origin}/v${input.version}`),
    cuaDriver: input.cuaDriver ?? CUA_DRIVER_VERSION,
    ...(input.commit ? { commit: input.commit } : {}),
    ...(input.channel === "nightly" ? { channel: "nightly" } : {}),
  };
};

const describeReleaseFiles = async (
  releaseDir: string,
  versionedBase: string,
): Promise<ReleaseFeedFile[]> => {
  const listed = parseChecksums(await Bun.file(join(releaseDir, CHECKSUMS_NAME)).text());
  const files: ReleaseFeedFile[] = [];
  for (const name of [...RELEASE_CHECKSUM_ARTIFACTS, CHECKSUMS_NAME]) {
    const file = Bun.file(join(releaseDir, name));
    if (!(await file.exists())) continue;
    const sha256 = await sha256Of(file);
    const expected = name === CHECKSUMS_NAME ? sha256 : listed.get(name);
    if (expected !== sha256) {
      throw new Error(`${name} does not match its line in ${CHECKSUMS_NAME}`);
    }
    files.push({
      name,
      ...describeReleaseFile(name),
      url: `${versionedBase}/${name}`,
      sha256,
      size: file.size,
    });
  }
  return files;
};

/** The feed and the documents derived from it, ready to upload under their keys. */
export const buildFeedDocuments = async (input: FeedInput): Promise<FeedDocuments> => {
  const feed = await buildReleaseFeed(input);
  const json = `${JSON.stringify(feed, null, 2)}\n`;
  const origin = (input.origin ?? RELEASE_FEED_ORIGIN).replace(/\/+$/, "");
  const pointers: Record<string, string> = { "releases/latest.json": json };
  if (input.channel !== "nightly") {
    pointers[githubCompatKey()] = `${JSON.stringify(githubShaped(feed), null, 2)}\n`;
  }
  for (const name of [WINDOWS_UPDATER_CONFIG, MAC_UPDATER_CONFIG]) {
    const config = Bun.file(join(input.releaseDir, name));
    if (!(await config.exists())) continue;
    pointers[`latest/${name}`] = absoluteUpdaterUrls(
      await config.text(),
      `${origin}/v${input.version}/`,
    );
  }
  return {
    versioned: {
      [`releases/v${input.version}.json`]: json,
      [`releases/v${input.version}.md`]: input.notes || `AOP ${input.version}\n`,
    },
    pointers,
  };
};

/**
 * The path AOP 0.10.0 to 0.10.4 read (GitHub's `releases/latest` API) under another origin.
 * Those installs reach the feed by setting `AOP_GITHUB_API_URL=https://getaop.com`.
 */
export const githubCompatKey = (): string =>
  new URL(latestReleaseApiUrl("https://x", LEGACY_RELEASE_REPO)).pathname.slice(1);

/** The feed in the shape of GitHub's release JSON, the part those installs parse. */
export const githubShaped = (feed: ReleaseFeed) => ({
  tag_name: `v${feed.version}`,
  html_url: feed.notesUrl,
  draft: false,
  prerelease: false,
  published_at: feed.publishedAt,
  body: feed.notes,
  assets: feed.files.map((file) => ({
    name: file.name,
    browser_download_url: file.url,
    size: file.size,
  })),
});

/**
 * electron-updater resolves the relative file names of `latest.yml` and `latest-mac.yml` against
 * the folder it read them from. The copy under `latest/` names the versioned files instead, so the
 * installer or zip it downloads (and the blockmaps it compares) always belong to this release,
 * whatever a cache still holds.
 */
export const absoluteUpdaterUrls = (yml: string, versionedBase: string): string =>
  yml.replace(
    /^(\s*(?:-\s+)?(?:url|path):\s*)(['"]?)([^'"\s]+)\2\s*$/gm,
    (line, prefix: string, _quote: string, value: string) =>
      value.includes("://") ? line : `${prefix}${versionedBase}${value}`,
  );

/** Writes the documents under `outDir`, each at its bucket key. */
export const writeFeedDocuments = async (docs: FeedDocuments, outDir: string): Promise<void> => {
  for (const [key, content] of Object.entries({ ...docs.versioned, ...docs.pointers })) {
    const path = join(outDir, key);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, content);
  }
};

const parseChecksums = (text: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [digest, name] = line.trim().split(/\s+/);
    if (digest && name) map.set(name, digest.toLowerCase());
  }
  return map;
};

const sha256Of = async (file: Bun.BunFile): Promise<string> => {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of file.stream()) hasher.update(chunk);
  return hasher.digest("hex");
};

const main = async (): Promise<void> => {
  const cli = cac("release-feed");
  cli
    .option("--dir <path>", "The release folder with checksums.sha256", { default: "dist/release" })
    .option("--version <version>", "The release version, x.y.z")
    .option("--notes-file <path>", "Markdown notes; missing means empty notes")
    .option("--published-at <iso>", "When the release was published")
    .option("--origin <url>", "The public origin; the channel's own by default")
    .option("--channel <channel>", "stable, or nightly for AOP Nightly", { default: "stable" })
    .option("--commit <sha>", "The commit the build was made from")
    .option("--out <path>", "Where to write the documents, by bucket key");
  const { options } = cli.parse();
  if (!options.version || !options.out) {
    throw new Error("Usage: release-feed.ts --version <x.y.z> --out <dir> [--dir <release dir>]");
  }
  const notesFile = options.notesFile ? Bun.file(String(options.notesFile)) : null;
  const notes = notesFile && (await notesFile.exists()) ? (await notesFile.text()).trim() : "";
  if (!notes) console.warn("No release notes found; the feed carries empty notes");
  const channel = parseReleaseChannel(String(options.channel));
  const docs = await buildFeedDocuments({
    releaseDir: String(options.dir),
    version: String(options.version),
    notes,
    publishedAt: String(options.publishedAt ?? new Date().toISOString()),
    origin: String(options.origin ?? CHANNELS[channel].feedOrigin),
    channel,
    commit: options.commit ? String(options.commit) : undefined,
  });
  await writeFeedDocuments(docs, String(options.out));
  console.log(
    `Wrote the release feed of ${options.version}: ${Object.keys({ ...docs.versioned, ...docs.pointers }).join(", ")}`,
  );
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
