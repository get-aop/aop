import { getLogger } from "@aop/infra";
import {
  createLogReadState,
  getFileSize,
  type LogReadState,
  readLogLines,
} from "../events/log-file-tailer.ts";
import type { ExecutionRepository } from "./execution-repository.ts";

const logger = getLogger("executor", "log-flusher");

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;

export interface LogFlusher {
  track: (stepExecutionId: string, logFile: string) => void;
  finalFlush: (stepExecutionId: string) => Promise<void>;
  start: () => void;
  stop: () => void;
}

export interface LogFlusherConfig {
  flushIntervalMs?: number;
  afterLogsSaved?: (stepExecutionId: string) => Promise<void> | void;
}

interface TrackedStep {
  logFile: string;
  readState: LogReadState;
  needsProjection: boolean;
}

export const createLogFlusher = (
  executionRepository: ExecutionRepository,
  config?: LogFlusherConfig,
): LogFlusher => {
  const flushIntervalMs = config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const tracked = new Map<string, TrackedStep>();
  let timer: Timer | undefined;

  const flushStep = async (
    stepExecutionId: string,
    entry: TrackedStep,
    includePartial = false,
  ): Promise<void> => {
    resetOffsetAfterRotation(entry);

    const flushed = await flushNewLines(
      executionRepository,
      stepExecutionId,
      entry,
      includePartial,
    );
    if (!flushed) {
      return;
    }

    if (!entry.needsProjection) return;

    try {
      await config?.afterLogsSaved?.(stepExecutionId);
      entry.needsProjection = false;
    } catch (err) {
      logger.warn("Failed to project logs for step {stepId}: {error}", {
        stepId: stepExecutionId,
        error: String(err),
      });
    }
  };

  const tick = async (): Promise<void> => {
    const entries = [...tracked.entries()];
    for (const [stepId, entry] of entries) {
      await flushStep(stepId, entry);
    }
  };

  return {
    track: (stepExecutionId, logFile) => {
      tracked.set(stepExecutionId, {
        logFile,
        readState: createLogReadState(),
        needsProjection: false,
      });
      logger.debug("Tracking step {stepId} for periodic log flushing", {
        stepId: stepExecutionId,
      });
    },

    finalFlush: async (stepExecutionId) => {
      const entry = tracked.get(stepExecutionId);
      if (!entry) return;

      // The run is over: consume a trailing partial line as the final row.
      await flushStep(stepExecutionId, entry, true);
      tracked.delete(stepExecutionId);
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

const resetOffsetAfterRotation = (entry: TrackedStep): void => {
  // Rotation rewrites the file, so its size drops below the read position.
  if (getFileSize(entry.logFile) >= entry.readState.byteOffset) {
    return;
  }

  logger.debug("Resetting log flush offset for rotated step log", {
    logFile: entry.logFile,
  });
  entry.readState = createLogReadState();
};

const flushNewLines = async (
  executionRepository: ExecutionRepository,
  stepExecutionId: string,
  entry: TrackedStep,
  includePartial: boolean,
): Promise<boolean> => {
  const { lines } = await readLogLines(entry.logFile, entry.readState, includePartial);
  if (lines.length === 0) {
    return true;
  }

  const now = new Date().toISOString();
  const logs = lines.map((content) => ({
    step_execution_id: stepExecutionId,
    content,
    created_at: now,
  }));

  try {
    await executionRepository.saveStepLogs(logs);
  } catch (err) {
    logger.warn("Failed to flush logs for step {stepId}: {error}", {
      stepId: stepExecutionId,
      error: String(err),
    });
    return false;
  }

  // readLogLines advanced entry.readState (byte offset and line count).
  entry.needsProjection = true;
  logger.debug("Flushed {count} log lines for step {stepId}", {
    count: lines.length,
    stepId: stepExecutionId,
  });
  return true;
};
