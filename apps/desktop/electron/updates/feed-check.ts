import {
  isNewerRelease,
  latestReleaseFeedUrl,
  parseReleaseFeed,
  RELEASE_FEED_ORIGIN,
} from "@aop/common";
import type { FetchLike } from "../connection/host-client";

export interface NewerRelease {
  version: string;
  /** The release notes page. */
  releaseUrl: string;
  /** The DMG for this Mac's architecture, or null when the release has none. */
  downloadUrl: string | null;
}

export interface FeedCheckInput {
  fetch: FetchLike;
  appVersion: string;
  arch: string;
  /** `AOP_RELEASE_FEED_URL`: a test points the app at a fake feed. */
  feedOrigin?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The published release when it is newer than this app, or null. Throws when the feed cannot be
 * read. The feed is the one on getaop.com: the repository's GitHub Releases are private.
 */
export const checkForNewerRelease = async (input: FeedCheckInput): Promise<NewerRelease | null> => {
  const response = await input.fetch(
    latestReleaseFeedUrl(input.feedOrigin ?? RELEASE_FEED_ORIGIN),
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`The release feed answered ${response.status}.`);
  const release = parseReleaseFeed(await response.json());
  if (!release || !isNewerRelease(release.version, input.appVersion)) return null;
  return {
    version: release.version,
    releaseUrl: release.url,
    downloadUrl: release.assets[`aop-macos-${macArch(input.arch)}.dmg`]?.url ?? null,
  };
};

const macArch = (arch: string): "arm64" | "x64" => (arch === "arm64" ? "arm64" : "x64");
