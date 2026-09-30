import {
  GITHUB_API_URL,
  latestReleaseApiUrl,
  parseGithubRelease,
  RELEASE_REPO,
  type ReleaseInfo,
} from "@aop/common";

export const CHECKSUMS_NAME = "checksums.sha256";
export const RUNTIME_ASSETS_NAME = "runtime-assets.tar.gz";

export type FetchFn = (input: string) => Promise<Response>;

export interface FeedConfig {
  /** The GitHub API origin; a test points it at a fake feed. */
  apiUrl: string;
  repo: string;
}

/** The feed is the published GitHub Releases of get-aop/aop-mono, like install.sh's fallback. */
export const feedConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): FeedConfig => ({
  apiUrl: env.AOP_GITHUB_API_URL?.trim() || GITHUB_API_URL,
  repo: env.AOP_GITHUB_REPO?.trim() || RELEASE_REPO,
});

/** The newest published release, or a message saying why the feed could not be read. */
export const fetchLatestRelease = async (
  config: FeedConfig,
  fetchFn: FetchFn = apiFetch,
): Promise<ReleaseInfo> => {
  const url = latestReleaseApiUrl(config.apiUrl, config.repo);
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (error) {
    throw new Error(`Could not reach the release feed at ${url}: ${messageOf(error)}`);
  }
  if (!response.ok) {
    throw new Error(`The release feed answered ${response.status} for ${url}`);
  }
  const release = parseGithubRelease(await response.json().catch(() => null));
  if (!release) throw new Error(`The release feed at ${url} did not describe a published release`);
  return release;
};

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** For the small JSON the feed answers with: a stuck connection gives up after 15 seconds. */
export const apiFetch: FetchFn = (input) =>
  fetch(input, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "aop-host-updater" },
    signal: AbortSignal.timeout(15_000),
  });

/** For the release files, which are large: ten minutes for the whole transfer. */
export const downloadFetch: FetchFn = (input) =>
  fetch(input, {
    headers: { "User-Agent": "aop-host-updater" },
    signal: AbortSignal.timeout(600_000),
  });
