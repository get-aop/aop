import type { Dirent } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths, getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";

const logger = getLogger("retention");

export const RETENTION_DAYS = 30;
export const RETENTION_INITIAL_DELAY_MS = 60_000;
export const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface RetentionService {
  start: () => void;
  stop: () => void;
  runOnce: () => Promise<RetentionRunResult>;
}

export interface RetentionRunResult {
  deletedStepLogs: number;
  deletedRuntimeEvents: number;
  clearedActivityMessages: number;
  removedTranscriptFiles: number;
}

/**
 * Bounded growth: hot paths read step_logs and runtime_events, and the session
 * transcript files under logs/chat-sessions can reach hundreds of MB. Rows and
 * files older than RETENTION_DAYS are dropped on a slow periodic timer.
 */
export const createRetentionService = (ctx: LocalServerContext): RetentionService => {
  let timer: ReturnType<typeof setInterval> | null = null;

  const runOnce = async (): Promise<RetentionRunResult> => {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const result: RetentionRunResult = {
      deletedStepLogs: 0,
      deletedRuntimeEvents: 0,
      clearedActivityMessages: 0,
      removedTranscriptFiles: 0,
    };

    try {
      const stepLogs = await ctx.db
        .deleteFrom("step_logs")
        .where("created_at", "<", cutoff)
        .executeTakeFirst();
      result.deletedStepLogs = Number(stepLogs.numDeletedRows);
    } catch (error) {
      logger.warn("Failed to prune step_logs: {error}", { error: String(error) });
    }

    try {
      const runtimeEvents = await ctx.db
        .deleteFrom("runtime_events")
        .where("created_at", "<", cutoff)
        .executeTakeFirst();
      result.deletedRuntimeEvents = Number(runtimeEvents.numDeletedRows);
    } catch (error) {
      logger.warn("Failed to prune runtime_events: {error}", { error: String(error) });
    }

    try {
      // Live activity buffers can reach ~2 MB per message; the final text lives
      // in `content`, so old activity blobs are safe to drop.
      const activity = await ctx.db
        .updateTable("chat_messages")
        .set({ activity: null })
        .where("activity", "is not", null)
        .where("created_at", "<", cutoff)
        .executeTakeFirst();
      result.clearedActivityMessages = Number(activity.numUpdatedRows);
    } catch (error) {
      logger.warn("Failed to clear stale chat message activity: {error}", {
        error: String(error),
      });
    }

    result.removedTranscriptFiles = await pruneTranscriptFiles(cutoffMs);

    if (
      result.deletedStepLogs > 0 ||
      result.deletedRuntimeEvents > 0 ||
      result.clearedActivityMessages > 0 ||
      result.removedTranscriptFiles > 0
    ) {
      logger.info(
        "Retention pruned {stepLogs} step logs, {events} runtime events, {activity} activity blobs, {files} transcript files",
        {
          stepLogs: result.deletedStepLogs,
          events: result.deletedRuntimeEvents,
          activity: result.clearedActivityMessages,
          files: result.removedTranscriptFiles,
        },
      );
    }
    return result;
  };

  return {
    start: () => {
      if (timer) return;
      setTimeout(() => {
        void runOnce();
      }, RETENTION_INITIAL_DELAY_MS);
      timer = setInterval(() => {
        void runOnce();
      }, RETENTION_INTERVAL_MS);
      logger.info("Retention started (older than {days} days)", { days: RETENTION_DAYS });
    },

    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    runOnce,
  };
};

const pruneTranscriptFiles = async (cutoffMs: number): Promise<number> => {
  const chatSessionsRoot = join(aopPaths.logs(), "chat-sessions");
  let removed = 0;

  let sessionDirs: Dirent[];
  try {
    sessionDirs = await readdir(chatSessionsRoot, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const dir of sessionDirs) {
    if (!dir.isDirectory()) continue;
    removed += await pruneSessionDir(join(chatSessionsRoot, dir.name), cutoffMs);
  }

  return removed;
};

const pruneSessionDir = async (dirPath: string, cutoffMs: number): Promise<number> => {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const file of entries) {
    const filePath = join(dirPath, file);
    try {
      const { mtimeMs } = await stat(filePath);
      if (mtimeMs >= cutoffMs) continue;
      await rm(filePath, { force: true });
      removed++;
    } catch {
      // File vanished between listing and stat/remove.
    }
  }
  return removed;
};
