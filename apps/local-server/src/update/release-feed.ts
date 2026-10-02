import {
  buildChannel,
  GITHUB_API_URL,
  latestReleaseApiUrl,
  latestReleaseFeedUrl,
  parseGithubRelease,
  parseReleaseFeed,
  RELEASE_REPO,
  type ReleaseChannel,
  type ReleaseInfo,
} from "@aop/common";

export const CHECKSUMS_NAME = "checksums.sha256";
export const RUNTIME_ASSETS_NAME = "runtime-assets.tar.gz";

export type FetchFn = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;

export interface GithubSource {
  apiUrl: string;
  repo: string;
  token: string;
}

export interface FeedConfig {
  /** The public origin of the release feed, getaop.com; a test points it at a fake one. */
  origin: string;
  /** Which builds the feed offers: a nightly host reads only nightlies, a stable one only releases. */
  channel: ReleaseChannel;
  /** The GitHub Releases, read only when the feed fails and a token can read the private repo. */
  github: GithubSource | null;
}

/**
 * The feed of this build's channel on getaop.com (`/nightly` for AOP Nightly), with GitHub as
 * the fallback when the environment holds a token. Nightlies are never GitHub releases, so a
 * nightly host has no fallback.
 */
export const feedConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  channel = buildChannel(),
): FeedConfig => {
  const token =
    env.AOP_GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim() || "";
  return {
    origin: env.AOP_RELEASE_FEED_URL?.trim() || channel.feedOrigin,
    channel: channel.id,
    github:
      token && channel.id === "stable"
        ? {
            apiUrl: env.AOP_GITHUB_API_URL?.trim() || GITHUB_API_URL,
            repo: env.AOP_GITHUB_REPO?.trim() || RELEASE_REPO,
            token,
          }
        : null,
  };
};

/** The newest published release, or a message saying why no source could be read. */
export const fetchLatestRelease = async (
  config: FeedConfig,
  fetchFn: FetchFn = apiFetch,
): Promise<ReleaseInfo> => {
  try {
    return await readSource(
      latestReleaseFeedUrl(config.origin),
      {},
      (json) => parseReleaseFeed(json, config.channel),
      fetchFn,
    );
  } catch (error) {
    if (!config.github) throw error;
    try {
      return await readGithub(config.github, fetchFn);
    } catch (fallbackError) {
      throw new Error(`${messageOf(error)} (GitHub fallback: ${messageOf(fallbackError)})`);
    }
  }
};

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** For the small JSON the feed answers with: a stuck connection gives up after 15 seconds. */
export const apiFetch: FetchFn = (input, init) =>
  fetch(input, {
    headers: { "User-Agent": "aop-host-updater", ...init?.headers },
    signal: AbortSignal.timeout(15_000),
  });

/**
 * For the release files, which are large: ten minutes for the whole transfer. A GitHub asset
 * answers with a redirect to signed storage, which must not receive the token, so a download
 * that carries one follows the redirect itself, without it.
 */
export const downloadFetch: FetchFn = async (input, init) => {
  const signal = AbortSignal.timeout(600_000);
  const headers: Record<string, string> = { "User-Agent": "aop-host-updater", ...init?.headers };
  if (!headers.Authorization) return fetch(input, { headers, signal });
  const first = await fetch(input, { headers, signal, redirect: "manual" });
  const location = first.headers.get("location");
  if (first.status < 300 || first.status >= 400 || !location) return first;
  return fetch(new URL(location, input).href, {
    headers: { "User-Agent": "aop-host-updater" },
    signal,
  });
};

// A private repository's assets download from their API address with the token and
// `Accept: application/octet-stream`; checksums.sha256 is what they are checked against.
const readGithub = async (github: GithubSource, fetchFn: FetchFn): Promise<ReleaseInfo> => {
  const authorization = `Bearer ${github.token}`;
  const release = await readSource(
    latestReleaseApiUrl(github.apiUrl, github.repo),
    { Accept: "application/vnd.github+json", Authorization: authorization },
    (json) => parseGithubRelease(json, { assetUrls: "api" }),
    fetchFn,
  );
  const headers = { Accept: "application/octet-stream", Authorization: authorization };
  return {
    ...release,
    assets: Object.fromEntries(
      Object.entries(release.assets).map(([name, asset]) => [name, { ...asset, headers }]),
    ),
  };
};

const readSource = async (
  url: string,
  headers: Record<string, string>,
  parse: (json: unknown) => ReleaseInfo | null,
  fetchFn: FetchFn,
): Promise<ReleaseInfo> => {
  let response: Response;
  try {
    response = await fetchFn(url, { headers });
  } catch (error) {
    throw new Error(`Could not reach the release feed at ${url}: ${messageOf(error)}`);
  }
  if (!response.ok) {
    throw new Error(`The release feed answered ${response.status} for ${url}`);
  }
  const release = parse(await response.json().catch(() => null));
  if (!release) throw new Error(`The release feed at ${url} did not describe a published release`);
  return release;
};
