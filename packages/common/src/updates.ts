import { z } from "zod";
import { normalizeReleaseVersion } from "./version.ts";

/**
 * The repository whose published GitHub Releases are the update feed for every AOP piece: the
 * host (`aop update`), the Windows app (electron-updater) and the macOS app's notice.
 */
export const RELEASE_REPO = "get-aop/aop-mono";

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
  assets: z
    .array(z.object({ name: z.string().min(1), browser_download_url: z.string().min(1) }))
    .default([]),
});

export interface ReleaseInfo {
  /** `x.y.z`, without the tag's `v`. */
  version: string;
  /** The release page, which holds the notes. */
  url: string;
  /** Asset name to download URL. */
  assets: Record<string, string>;
}

/** Reads GitHub's release JSON into what an updater needs, or null when it is not a usable release. */
export const parseGithubRelease = (json: unknown): ReleaseInfo | null => {
  const parsed = GithubReleaseSchema.safeParse(json);
  if (!parsed.success || parsed.data.draft || parsed.data.prerelease) return null;
  const version = normalizeReleaseVersion(parsed.data.tag_name);
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return {
    version,
    url: parsed.data.html_url,
    assets: Object.fromEntries(parsed.data.assets.map((a) => [a.name, a.browser_download_url])),
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
