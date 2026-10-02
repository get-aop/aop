import { z } from "zod";
import { normalizeReleaseVersion } from "./version.ts";

/**
 * The repository whose GitHub Releases the release workflow creates. It is private, so the
 * updaters read the public feed on getaop.com (release-feed.ts) and fall back to these releases
 * only with a token.
 */
export const RELEASE_REPO = "get-aop/aop";

/** The GitHub API origin. A test points the host and the apps at a fake feed instead. */
export const GITHUB_API_URL = "https://api.github.com";

/** Where the newest published (non-draft, non-pre-release) release of `repo` is described. */
export const latestReleaseApiUrl = (
  apiBase: string = GITHUB_API_URL,
  repo: string = RELEASE_REPO,
): string => `${apiBase.replace(/\/+$/, "")}/repos/${repo}/releases/latest`;

/** The part of GitHub's release JSON the updaters read. */
export const GithubReleaseSchema = z.object({
  tag_name: z.string().min(1),
  html_url: z.string().min(1),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  body: z.string().nullish(),
  assets: z
    .array(
      z.object({
        name: z.string().min(1),
        browser_download_url: z.string().min(1),
        /** The API address of the asset, which a token can download from a private repository. */
        url: z.string().optional(),
      }),
    )
    .default([]),
});

/** One file of a release and, when the source says it, the sha256 it must have. */
export interface ReleaseAsset {
  url: string;
  sha256: string | null;
  /** Sent with the download: the token a private repository's asset needs. */
  headers?: Record<string, string>;
}

export interface ReleaseInfo {
  /** `x.y.z`, without the tag's `v`. */
  version: string;
  /** The release notes page. */
  url: string;
  /** The notes themselves (markdown), when the source carries them. */
  notes: string | null;
  /** Asset name to where it downloads from. */
  assets: Record<string, ReleaseAsset>;
}

/**
 * Reads GitHub's release JSON into what an updater needs, or null when it is not a usable
 * release. `assetUrls: "api"` takes each asset's API address, the one a token can download.
 */
export const parseGithubRelease = (
  json: unknown,
  { assetUrls = "browser" }: { assetUrls?: "browser" | "api" } = {},
): ReleaseInfo | null => {
  const parsed = GithubReleaseSchema.safeParse(json);
  if (!parsed.success || parsed.data.draft || parsed.data.prerelease) return null;
  const version = normalizeReleaseVersion(parsed.data.tag_name);
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return {
    version,
    url: parsed.data.html_url,
    notes: parsed.data.body ?? null,
    assets: Object.fromEntries(
      parsed.data.assets.map((a) => [
        a.name,
        { url: assetUrls === "api" && a.url ? a.url : a.browser_download_url, sha256: null },
      ]),
    ),
  };
};

/**
 * What `GET /api/updates` tells any authenticated client about the host's own release: the
 * dashboard shows the notice from it, and only the host owner may act on it.
 */
export const UpdateStatusSchema = z.object({
  /** The host looks for new releases (the `update_check` setting). */
  enabled: z.boolean(),
  /** The host is an installed build that can replace itself; false for a source checkout. */
  supported: z.boolean(),
  /** The running release, `x.y.z`, or `dev`. */
  current: z.string(),
  /** The newest published release the last check saw, or null before the first successful check. */
  latest: z.string().nullable(),
  /** `latest` is newer than `current`. */
  available: z.boolean(),
  /** The release notes page of `latest`. */
  releaseUrl: z.string().nullable(),
  checkedAt: z.string().nullable(),
  checkError: z.string().nullable(),
  /** `updating` from the moment the owner starts an update until the host restarts on the new release. */
  state: z.enum(["idle", "updating", "failed"]),
  updateError: z.string().nullable(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
