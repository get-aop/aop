import {
  GITHUB_API_URL,
  isNewerRelease,
  latestReleaseApiUrl,
  parseGithubRelease,
} from "@aop/common";
import type { FetchLike } from "../connection/host-client";

export interface NewerRelease {
  version: string;
  /** The release page, which holds the notes. */
  releaseUrl: string;
  /** The DMG for this Mac's architecture, or null when the release has none. */
  downloadUrl: string | null;
}

export interface FeedCheckInput {
  fetch: FetchLike;
  appVersion: string;
  arch: string;
  /** `AOP_GITHUB_API_URL`: a test points the app at a fake feed. */
  apiBase?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

/** The published release when it is newer than this app, or null. Throws when the feed cannot be read. */
export const checkForNewerRelease = async (input: FeedCheckInput): Promise<NewerRelease | null> => {
  const response = await input.fetch(latestReleaseApiUrl(input.apiBase ?? GITHUB_API_URL), {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The release feed answered ${response.status}.`);
  const release = parseGithubRelease(await response.json());
  if (!release || !isNewerRelease(release.version, input.appVersion)) return null;
  return {
    version: release.version,
    releaseUrl: release.url,
    downloadUrl: release.assets[`aop-macos-${macArch(input.arch)}.dmg`] ?? null,
  };
};

const macArch = (arch: string): "arm64" | "x64" => (arch === "arm64" ? "arm64" : "x64");
