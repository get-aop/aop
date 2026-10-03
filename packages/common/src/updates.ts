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
 * Who may manage this host (the host setting `host_management`): update it, update its agent
 * CLIs, change its update settings, and pair or revoke devices. `devices`: the host machine and
 * every paired device (the default: the person's everyday setup is an app on another computer).
 * `owner`: only requests made on the host machine itself. Only the host machine changes it.
 */
export const HostManagementSchema = z.enum(["devices", "owner"]);
export type HostManagement = z.infer<typeof HostManagementSchema>;

export const DEFAULT_HOST_MANAGEMENT: HostManagement = "devices";

/** Reads a stored setting value; anything unknown falls back to the default. */
export const parseHostManagement = (value: string | null | undefined): HostManagement => {
  const parsed = HostManagementSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_HOST_MANAGEMENT;
};

/** Whether a caller may manage the host under a setting. The host enforces it; clients follow. */
export const mayManageHost = (setting: HostManagement, caller: "owner" | "device"): boolean =>
  caller === "owner" || setting === "devices";

/**
 * How the host is kept running, which decides what an update does: `service` (launchd or
 * systemd) and `background` (`aop run --background`) restart onto the new release by themselves;
 * `manual` (started by hand) installs it and needs a restart; `app` is a host the desktop app runs,
 * which updates with the app; `source` is a checkout, which pulls and rebuilds.
 */
export const HostRestartSchema = z.enum(["service", "background", "manual", "app", "source"]);
export type HostRestart = z.infer<typeof HostRestartSchema>;

/** A turn the host is running now, named the way the person knows it. */
export const RunningTurnSchema = z.object({
  /** The thread's title, or the project's name for its coordinator. */
  title: z.string(),
  kind: z.enum(["thread", "coordinator", "chat"]),
});
export type RunningTurn = z.infer<typeof RunningTurnSchema>;

/** After this long a queued "update when they finish" stops waiting and asks again. */
export const QUEUED_UPDATE_MAX_WAIT_MS = 6 * 60 * 60 * 1000;

/**
 * An update queued to start once the turns running when it was asked for have finished. The
 * host keeps it, so it still happens after the window that asked is closed.
 */
export const QueuedUpdateSchema = z.object({
  since: z.string(),
  /** The release it installs. */
  version: z.string(),
  /** How many of the turns it waits for are still running. */
  waitingFor: z.number().int().nonnegative(),
  /** Who queued it: a person, or Nightly's own automatic install. */
  by: z.enum(["person", "auto"]),
  /** It waited `QUEUED_UPDATE_MAX_WAIT_MS` without the turns finishing, and now waits for a person. */
  expired: z.boolean(),
});
export type QueuedUpdate = z.infer<typeof QueuedUpdateSchema>;

/**
 * When the host installs a release by itself (the host setting `update_install`): `ask` leaves it
 * to a person (the Updates button shows it; the default on Stable); `idle` installs once the turns
 * running when it was found have finished (the default on Nightly); `window` does the same, but
 * only between the `update_install_window` hours, host time.
 */
export const UpdateInstallModeSchema = z.enum(["ask", "idle", "window"]);
export type UpdateInstallMode = z.infer<typeof UpdateInstallModeSchema>;

/** The `update_install_window` setting: `HH:MM-HH:MM`, host time; it may wrap past midnight. */
export const DEFAULT_UPDATE_INSTALL_WINDOW = "01:00-06:00";

/** `[startMinute, endMinute)` of a window setting, or null when it is not one. */
export const parseInstallWindow = (value: string): [number, number] | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const [, sh, sm, eh, em] = match.map(Number);
  const start = (sh ?? 0) * 60 + (sm ?? 0);
  const end = (eh ?? 0) * 60 + (em ?? 0);
  return start === end ? null : [start, end];
};

/** Whether `minuteOfDay` (0..1439, host time) falls inside the window. */
export const inInstallWindow = (window: [number, number], minuteOfDay: number): boolean => {
  const [start, end] = window;
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
};

/**
 * The newest release staged ahead of time (the host setting `update_background_download`):
 * downloaded and checked, not installed, so "Update host" only has to swap and restart.
 */
export const UpdateDownloadSchema = z.object({
  state: z.enum(["idle", "downloading", "ready", "failed"]),
  version: z.string().nullable(),
  error: z.string().nullable(),
});
export type UpdateDownload = z.infer<typeof UpdateDownloadSchema>;

/** How the last update run went, for "Previous update" on the Updates page. */
export const PreviousUpdateSchema = z.object({
  at: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  ok: z.boolean(),
  /** How long the run took, when it recorded its start. */
  seconds: z.number().nullable(),
  error: z.string().nullable(),
});
export type PreviousUpdate = z.infer<typeof PreviousUpdateSchema>;

/** When `POST /api/updates/apply` starts the update: at once, or once the running turns finish. */
export const ApplyUpdateRequestSchema = z.object({
  when: z.enum(["now", "idle"]).default("now"),
});
export type ApplyUpdateRequest = z.infer<typeof ApplyUpdateRequestSchema>;

/**
 * What `GET /api/updates` tells any authenticated client about the host's own release: the
 * dashboard shows the notice from it, and `canUpdate` says whether this caller may act on it.
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
  /**
   * `updating` from the moment an update starts until the host restarts on the new release;
   * `installed` when a host started by hand has the new release on disk and needs a restart to
   * use it (`updateError` then says how); `failed` when the run failed or was rolled back.
   */
  state: z.enum(["idle", "updating", "installed", "failed"]),
  updateError: z.string().nullable(),
  /** The host's name, as people call it ("soulf"). */
  hostName: z.string(),
  /**
   * This caller may start, queue and cancel an update, check for one, and change the update
   * settings (the `host_management` setting). Without it, a client says why, never just hides.
   */
  canUpdate: z.boolean(),
  /** The host machine itself is asking: the only caller that may change `host_management`. */
  owner: z.boolean(),
  /** The `host_management` setting, so a client can say who may update. */
  hostManagement: HostManagementSchema,
  restart: HostRestartSchema,
  /** Turns an update now would restart the host under. */
  runningTurns: z.array(RunningTurnSchema),
  queued: QueuedUpdateSchema.nullable(),
  download: UpdateDownloadSchema,
  previous: PreviousUpdateSchema.nullable(),
  /** What else the update brings, when the feed says: the CUA Driver version AOP pins. */
  includes: z.object({
    cuaDriver: z.object({ from: z.string(), to: z.string() }).nullable(),
  }),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
