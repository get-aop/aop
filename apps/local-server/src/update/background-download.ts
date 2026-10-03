import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { isNewerBuild, type UpdateDownload } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { HostPlatform } from "./install-layout.ts";
import {
  apiFetch,
  downloadFetch,
  type FeedConfig,
  type FetchFn,
  fetchLatestRelease,
  messageOf,
} from "./release-feed.ts";
import { downloadVerified, hostReleaseFiles } from "./stage.ts";
import {
  commitStagedRelease,
  listStagedReleases,
  pruneStagedReleases,
  readStagedRelease,
} from "./staged-files.ts";

const logger = getLogger("update");

/** After a failed download, the next one waits this long, so a full disk is not hit every poll. */
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;

const IDLE: UpdateDownload = { state: "idle", version: null, error: null };

/**
 * "Download updates in the background": the newest release, downloaded and checked against the
 * feed's sha256 ahead of time, so "Update host" (and an automatic install) only has to swap and
 * restart. Nothing in the install changes here (staged-files.ts).
 */
export interface ReleaseStager {
  /**
   * Stages the newest release unless `version` (or a newer one: the feed moved on since the last
   * check) is staged already; drops every older one.
   */
  stage: (version: string) => Promise<void>;
  /** Drops every staged release but `keep`: once installed, a release is not needed here. */
  prune: (keep: string | null) => Promise<void>;
  /** What clients see of `version` (the newer release the last check saw, or null). */
  view: (version: string | null) => Promise<UpdateDownload>;
}

export interface ReleaseStagerDeps {
  /** `update-staged/` under the host's data folder (staged-files.ts stagedReleasesDir). */
  root: string;
  feed: FeedConfig;
  platform: HostPlatform;
  /** For the feed's small JSON. */
  fetch?: FetchFn;
  /** For the release files, which are large. */
  downloadFetch?: FetchFn;
  now?: () => number;
}

interface Attempt {
  version: string;
  state: "downloading" | "failed";
  error: string | null;
  at: number;
}

export const createReleaseStager = (deps: ReleaseStagerDeps): ReleaseStager => {
  const now = deps.now ?? Date.now;
  let attempt: Attempt | null = null;
  let running: Promise<void> | null = null;

  const download = async (): Promise<void> => {
    await pruneStagedReleases(deps.root, null);
    const release = await fetchLatestRelease(deps.feed, deps.fetch ?? apiFetch);
    const partial = await mkdtemp(join(deps.root, ".partial-"));
    try {
      const files = hostReleaseFiles(deps.platform);
      await downloadVerified(release, files, partial, deps.downloadFetch ?? downloadFetch);
      await commitStagedRelease(deps.root, release.version, partial);
      logger.info("AOP {version} is downloaded and checked, ready to install", {
        version: release.version,
      });
    } catch (error) {
      await rm(partial, { recursive: true, force: true });
      throw error;
    }
  };

  // What is staged already that serves `version`: itself, or a newer one the feed offered when
  // it was downloaded, which the next check will see too.
  const stagedFor = async (version: string): Promise<string | null> => {
    const staged = await listStagedReleases(deps.root);
    if (staged.includes(version)) return version;
    return staged.find((other) => isNewerBuild(other, version, deps.feed.channel)) ?? null;
  };

  const retryLater = (version: string): boolean =>
    attempt?.version === version &&
    attempt.state === "failed" &&
    now() - attempt.at < RETRY_AFTER_FAILURE_MS;

  const start = (version: string): Promise<void> => {
    attempt = { version, state: "downloading", error: null, at: now() };
    running = download()
      .then(() => {
        attempt = null;
      })
      .catch((error) => {
        attempt = { version, state: "failed", error: messageOf(error), at: now() };
        logger.warn("Downloading AOP {version} ahead of time failed: {error}", {
          version,
          error: attempt.error,
        });
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  return {
    stage: async (version) => {
      if (running) return running;
      const staged = await stagedFor(version);
      if (staged) return pruneStagedReleases(deps.root, staged);
      if (retryLater(version)) return;
      await mkdir(deps.root, { recursive: true });
      return start(version);
    },
    prune: (keep) => (running ? Promise.resolve() : pruneStagedReleases(deps.root, keep)),
    view: async (version) => {
      if (!version) return IDLE;
      if (attempt?.version === version) {
        return { state: attempt.state, version, error: attempt.error };
      }
      return (await readStagedRelease(deps.root, version))
        ? { state: "ready", version, error: null }
        : IDLE;
    },
  };
};
