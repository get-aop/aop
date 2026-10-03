import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths, getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { startPeriodicJob } from "../process/periodic-job.ts";
import { backfillSentAttachments } from "./chat-index.ts";
import { effectiveRetention, hostLibraryDefaults, megabytes, retentionCutoff } from "./item-dto.ts";
import { removeLibraryItem } from "./removal.ts";
import { createLibraryRepository, type LibraryRepository } from "./repository.ts";
import { listBlobs, removeBlob, removeBlobLeftover, withLibraryLock } from "./store.ts";

const logger = getLogger("library", "retention");

const DAY_MS = 24 * 60 * 60 * 1000;
/** A blob no item names yet may be a save in flight; one older than this is a leftover. */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;
/** The first cleanup waits this long after the host starts, so it never slows the start. */
export const RETENTION_STARTUP_DELAY_MS = 60 * 1000;
export const RETENTION_INTERVAL_MS = DAY_MS;

export interface RetentionReport {
  /** Sent attachments put in the Library by the sweep (ones the live index missed). */
  indexed: number;
  /** Automatic items older than their project's retention. */
  expired: number;
  /** Automatic items removed, least recently used first, to bring a cap back under its limit. */
  evicted: number;
  /** Blobs and half-written files no item uses; rows of chats that no longer exist. */
  orphans: number;
}

/**
 * The Library's daily cleanup. Idempotent: a second run right after the first finds nothing to
 * do. Each project is cleaned under its Library lock, so it is safe while the host serves saves
 * and uploads, and a project that fails is logged and skipped rather than stopping the rest.
 */
export const runLibraryRetention = async (
  ctx: LocalServerContext,
  now: Date = new Date(),
): Promise<RetentionReport> => {
  const repository = createLibraryRepository(ctx.db);
  const report: RetentionReport = { indexed: 0, expired: 0, evicted: 0, orphans: 0 };
  report.indexed = await backfillSentAttachments(ctx.db);
  const { hostCapMb, ...defaults } = await hostLibraryDefaults(ctx.settingsRepository);

  for (const projectId of await libraryProjects(repository)) {
    try {
      await withLibraryLock(projectId, async () => {
        const settings = await repository.getSettings(projectId);
        const retention = effectiveRetention(settings, defaults);
        await cleanProject(repository, projectId, retention, now, report);
      });
    } catch (error) {
      logger.error("Library cleanup of project {projectId} failed: {error}", {
        projectId,
        error: String(error),
      });
    }
  }
  const hostCapBytes = megabytes(hostCapMb);
  if (hostCapBytes !== null) report.evicted += await enforceHostCap(repository, hostCapBytes, now);

  logger.info(
    "Library cleanup: {indexed} indexed, {expired} expired, {evicted} evicted, {orphans} orphans removed",
    { ...report },
  );
  return report;
};

/**
 * Removes the project's least recently used automatic items until it holds no more than
 * `capBytes`. `keepId` is never removed: the item a save just made. Call under the lock.
 */
export const enforceProjectCap = async (
  repository: LibraryRepository,
  projectId: string,
  capBytes: number,
  now: Date,
  keepId?: string,
): Promise<number> => {
  if ((await repository.usedBytes(projectId)) <= capBytes) return 0;
  let evicted = 0;
  for (const row of await repository.evictionCandidates(projectId)) {
    if (row.id === keepId) continue;
    await removeLibraryItem(repository, row, "expired", now);
    evicted++;
    if ((await repository.usedBytes(projectId)) <= capBytes) break;
  }
  return evicted;
};

/** Runs the cleanup shortly after start and then once a day. Returns what stops it. */
export const startLibraryRetention = (
  run: () => Promise<unknown>,
  timing: { startupDelayMs?: number; intervalMs?: number } = {},
): (() => void) =>
  startPeriodicJob({
    name: "Library cleanup",
    run,
    startupDelayMs: timing.startupDelayMs ?? RETENTION_STARTUP_DELAY_MS,
    intervalMs: timing.intervalMs ?? RETENTION_INTERVAL_MS,
  });

const cleanProject = async (
  repository: LibraryRepository,
  projectId: string,
  retention: { retentionDays: number; capMb: number },
  now: Date,
  report: RetentionReport,
): Promise<void> => {
  // A deleted chat took its attachments with it; its rows have nothing left to show.
  for (const row of await repository.orphanedChatItems(projectId)) {
    await repository.delete(row.id);
    report.orphans++;
  }
  if (retention.retentionDays > 0) {
    const cutoff = retentionCutoff(now, retention.retentionDays);
    for (const row of await repository.addedBefore(projectId, cutoff)) {
      await removeLibraryItem(repository, row, "expired", now);
      report.expired++;
    }
  }
  const capBytes = megabytes(retention.capMb);
  if (capBytes !== null) {
    report.evicted += await enforceProjectCap(repository, projectId, capBytes, now);
  }
  report.orphans += await sweepBlobs(repository, projectId, now);
};

const sweepBlobs = async (
  repository: LibraryRepository,
  projectId: string,
  now: Date,
): Promise<number> => {
  let removed = 0;
  for (const blob of await listBlobs(projectId)) {
    if (now.getTime() - blob.mtimeMs < ORPHAN_GRACE_MS) continue;
    if (blob.sha256 === null) {
      await removeBlobLeftover(projectId, blob.name);
      removed++;
    } else if ((await repository.blobUsers(projectId, blob.sha256)) === 0) {
      await removeBlob(projectId, blob.sha256);
      removed++;
    }
  }
  return removed;
};

// Every project's automatic items compete for the host's cap; each removal takes its project's
// lock and checks the item is still live and unpinned, since the person may have pinned it since.
const enforceHostCap = async (
  repository: LibraryRepository,
  capBytes: number,
  now: Date,
): Promise<number> => {
  if ((await repository.usedBytes(null)) <= capBytes) return 0;
  let evicted = 0;
  for (const candidate of await repository.evictionCandidates(null)) {
    const removed = await withLibraryLock(candidate.project_id, async () => {
      const row = await repository.getLive(candidate.project_id, candidate.id);
      if (!row || row.pinned === 1) return false;
      await removeLibraryItem(repository, row, "expired", now);
      return true;
    });
    if (removed) evicted++;
    if ((await repository.usedBytes(null)) <= capBytes) break;
  }
  return evicted;
};

// Projects with items, and any with a blobs folder left (all of its items deleted).
const libraryProjects = async (repository: LibraryRepository): Promise<string[]> => {
  const projectsDir = join(aopPaths.home(), "projects");
  const withFolders = await readdir(projectsDir).catch(() => [] as string[]);
  const withBlobs: string[] = [];
  for (const projectId of withFolders) {
    if ((await listBlobs(projectId)).length > 0) withBlobs.push(projectId);
  }
  return [...new Set([...(await repository.projectIds()), ...withBlobs])];
};
