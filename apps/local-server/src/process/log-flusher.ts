import { getLogger } from "@aop/infra";
import { createLogReadState, getFileSize, type LogReadState, readLogLines } from "./log-tail.ts";

const logger = getLogger("process", "log-flusher");

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;

/**
 * Periodically moves complete lines appended to each tracked run's log file into a
 * sink. Runs are keyed by an opaque run id; the sink decides where lines persist.
 */
export interface LogFlusher {
  track: (runId: string, logFile: string) => void;
  finalFlush: (runId: string) => Promise<void>;
  start: () => void;
  stop: () => void;
}

export interface LogFlusherConfig {
  /** Persists lines appended since the last flush. A rejection keeps them for the next tick. */
  saveLines: (runId: string, lines: string[]) => Promise<void>;
  /** Runs after new lines were saved (for example, projecting them into events). */
  afterLinesSaved?: (runId: string) => Promise<void> | void;
  flushIntervalMs?: number;
}

interface TrackedRun {
  logFile: string;
  readState: LogReadState;
  needsProjection: boolean;
}

export const createLogFlusher = (config: LogFlusherConfig): LogFlusher => {
  const flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const tracked = new Map<string, TrackedRun>();
  let timer: Timer | undefined;

  const flushRun = async (runId: string, entry: TrackedRun, includePartial = false) => {
    resetOffsetAfterRotation(entry);

    const flushed = await flushNewLines(config, runId, entry, includePartial);
    if (!flushed || !entry.needsProjection) return;

    try {
      await config.afterLinesSaved?.(runId);
      entry.needsProjection = false;
    } catch (err) {
      logger.warn("Failed to project logs for run {runId}: {error}", {
        runId,
        error: String(err),
      });
    }
  };

  const tick = async (): Promise<void> => {
    for (const [runId, entry] of [...tracked.entries()]) {
      await flushRun(runId, entry);
    }
  };

  return {
    track: (runId, logFile) => {
      tracked.set(runId, { logFile, readState: createLogReadState(), needsProjection: false });
      logger.debug("Tracking run {runId} for periodic log flushing", { runId });
    },

    finalFlush: async (runId) => {
      const entry = tracked.get(runId);
      if (!entry) return;

      // The run is over: consume a trailing partial line as the final row.
      await flushRun(runId, entry, true);
      tracked.delete(runId);
    },

    start: () => {
      if (timer) return;
      timer = setInterval(() => void tick(), flushIntervalMs);
      logger.info("Log flusher started with {interval}ms interval", {
        interval: flushIntervalMs,
      });
    },

    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      tracked.clear();
      logger.info("Log flusher stopped");
    },
  };
};

const resetOffsetAfterRotation = (entry: TrackedRun): void => {
  // Rotation rewrites the file, so its size drops below the read position.
  if (getFileSize(entry.logFile) >= entry.readState.byteOffset) {
    return;
  }

  logger.debug("Resetting log flush offset for rotated run log", { logFile: entry.logFile });
  entry.readState = createLogReadState();
};

const flushNewLines = async (
  config: LogFlusherConfig,
  runId: string,
  entry: TrackedRun,
  includePartial: boolean,
): Promise<boolean> => {
  // Read into a copy so a failed save re-reads the same bytes on the next tick.
  const readState = { ...entry.readState };
  const { lines } = await readLogLines(entry.logFile, readState, includePartial);
  if (lines.length === 0) {
    return true;
  }

  try {
    await config.saveLines(runId, lines);
  } catch (err) {
    logger.warn("Failed to flush logs for run {runId}: {error}", {
      runId,
      error: String(err),
    });
    return false;
  }

  entry.readState = readState;
  entry.needsProjection = true;
  logger.debug("Flushed {count} log lines for run {runId}", { count: lines.length, runId });
  return true;
};
