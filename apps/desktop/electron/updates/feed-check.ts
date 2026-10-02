import {
  buildChannel,
  type ChannelConfig,
  isNewerBuild,
  latestReleaseFeedUrl,
  parseReleaseFeed,
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
  /** Whose feed to read: this app's channel unless a test says otherwise. */
  channel?: ChannelConfig;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The published release when it is newer than this app, or null. Throws when the feed cannot be
 * read. The feed is this channel's on getaop.com (`/nightly` for AOP Nightly).
 */
export const checkForNewerRelease = async (input: FeedCheckInput): Promise<NewerRelease | null> => {
  const channel = input.channel ?? buildChannel();
  const response = await input.fetch(latestReleaseFeedUrl(input.feedOrigin ?? channel.feedOrigin), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The release feed answered ${response.status}.`);
  const release = parseReleaseFeed(await response.json(), channel.id);
  if (!release || !isNewerBuild(release.version, input.appVersion, channel.id)) return null;
  return {
    version: release.version,
    releaseUrl: release.url,
    downloadUrl: release.assets[`aop-macos-${macArch(input.arch)}.dmg`]?.url ?? null,
  };
};

const macArch = (arch: string): "arm64" | "x64" => (arch === "arm64" ? "arm64" : "x64");
