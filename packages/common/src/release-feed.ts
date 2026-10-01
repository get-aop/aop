import { z } from "zod";
import type { ReleaseInfo } from "./updates.ts";
import { isReleaseVersion, normalizeReleaseVersion } from "./version.ts";

/**
 * The public origin every release is published to (Cloudflare R2 behind getaop.com): the
 * versioned files under `/vX.Y.Z/`, install.sh, and the release feed the updaters read. The
 * repository is private, so its GitHub Releases are not something an install can read.
 */
export const RELEASE_FEED_ORIGIN = "https://getaop.com";

/** The feed of the newest release. A breaking change to its shape goes to a new path. */
export const latestReleaseFeedUrl = (origin: string = RELEASE_FEED_ORIGIN): string =>
  `${trimOrigin(origin)}/releases/latest.json`;

/** The same document for one release, which stays put after newer ones ship. */
export const releaseFeedUrl = (version: string, origin: string = RELEASE_FEED_ORIGIN): string =>
  `${trimOrigin(origin)}/releases/v${version}.json`;

/** The release notes as plain text, the page the "Release notes" links open. */
export const releaseNotesUrl = (version: string, origin: string = RELEASE_FEED_ORIGIN): string =>
  `${trimOrigin(origin)}/releases/v${version}.md`;

/** Where electron-updater (the Windows app) reads `latest.yml` from. */
export const desktopUpdaterFeedUrl = (origin: string = RELEASE_FEED_ORIGIN): string =>
  `${trimOrigin(origin)}/latest/`;

const ReleaseFeedFileSchema = z.object({
  name: z.string().min(1),
  /** `host`, `runtime-assets`, `desktop` or `checksums`; a reader ignores kinds it does not know. */
  kind: z.string().min(1),
  os: z.string().optional(),
  arch: z.string().optional(),
  url: z.string().url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
});
export type ReleaseFeedFile = z.infer<typeof ReleaseFeedFileSchema>;

/** `releases/latest.json` and `releases/vX.Y.Z.json`, written by scripts/release/release-feed.ts. */
export const ReleaseFeedSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  publishedAt: z.string().min(1),
  /** Markdown, as GitHub generated it for the release. */
  notes: z.string(),
  notesUrl: z.string().url(),
  files: z.array(ReleaseFeedFileSchema),
});
export type ReleaseFeed = z.infer<typeof ReleaseFeedSchema>;

/** Reads the feed into what an updater needs, or null when it does not describe a release. */
export const parseReleaseFeed = (json: unknown): ReleaseInfo | null => {
  const parsed = ReleaseFeedSchema.safeParse(json);
  if (!parsed.success || !isReleaseVersion(parsed.data.version)) return null;
  const feed = parsed.data;
  return {
    version: normalizeReleaseVersion(feed.version),
    url: feed.notesUrl,
    notes: feed.notes,
    assets: Object.fromEntries(
      feed.files.map((file) => [file.name, { url: file.url, sha256: file.sha256 }]),
    ),
  };
};

/** What a release file is for, by the names the release workflow gives them. */
export const describeReleaseFile = (
  name: string,
): Pick<ReleaseFeedFile, "kind" | "os" | "arch"> => {
  const host = name.match(/^aop-(darwin|linux)-(x64|arm64)$/);
  if (host) return { kind: "host", os: host[1], arch: host[2] };
  const desktop = name.match(/^aop-(macos|windows)-(x64|arm64)(?:\.dmg|-setup\.exe)$/);
  if (desktop) return { kind: "desktop", os: desktop[1], arch: desktop[2] };
  if (name === "runtime-assets.tar.gz") return { kind: "runtime-assets" };
  if (name === "checksums.sha256") return { kind: "checksums" };
  return { kind: "other" };
};

const trimOrigin = (origin: string): string => origin.replace(/\/+$/, "");
