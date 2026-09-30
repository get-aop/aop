import { existsSync, readFileSync } from "node:fs";
import {
  inferRunOutcomeFromRawJsonl,
  type LLMProvider,
  parseRawJsonlContent,
  type RunOptions,
  type RunResult,
  sanitizeSessionId,
} from "@aop/llm-provider";
import { isAgentRunning, REAPER_POLL_INTERVAL_MS } from "./liveness.ts";

const PROVIDER_RUN_GRACE_MS = 1500;

export interface ReapOptions {
  pollIntervalMs?: number;
  /** How long a dead process's provider.run() may take to report its own result. */
  graceMs?: number;
  /** Reads the outcome when the provider never reports one (defaults to the JSONL log). */
  readResultFromLog?: (logFile: string) => RunResult;
}

/**
 * Runs a detached agent CLI to completion. Two paths race:
 * - provider.run() resolving (proc.exited fired, or a mock provider);
 * - pid polling, the primary path for detached, unref'd agents whose exit may never
 *   be reported. Once the pid is gone the provider gets `graceMs` to report its own
 *   result; otherwise the outcome is read from the log.
 * When provider.run() resolves while the pid is still alive (the result line was
 * written but the process has not exited), completion waits for the pid so callers
 * never act on a workspace the agent still holds.
 */
export const runAndReap = (
  provider: LLMProvider,
  options: RunOptions,
  reap: ReapOptions = {},
): Promise<RunResult> => {
  const pollIntervalMs = reap.pollIntervalMs ?? REAPER_POLL_INTERVAL_MS;
  const graceMs = reap.graceMs ?? PROVIDER_RUN_GRACE_MS;
  const readResult = reap.readResultFromLog ?? readRunResultFromLog;

  return new Promise<RunResult>((resolve, reject) => {
    let settled = false;
    let reaping = false;
    let pollInterval: Timer | undefined;
    let providerRunPromise: Promise<RunResult> | null = null;
    let spawnedPid: number | null = null;

    const settle = (result: RunResult) => {
      if (settled) return;
      settled = true;
      if (pollInterval) clearInterval(pollInterval);
      resolve(result);
    };

    const settleFromPollPath = async () => {
      if (settled || reaping) return;
      reaping = true;
      const providerResult = await waitForProviderRun(providerRunPromise, graceMs);
      settle(providerResult ?? readResult(options.logFilePath ?? ""));
    };

    providerRunPromise = provider.run({
      ...options,
      onSpawn: async (pid) => {
        spawnedPid = pid;
        await options.onSpawn?.(pid);
        if (!isAgentRunning(pid)) {
          void settleFromPollPath();
          return;
        }
        pollInterval = setInterval(() => {
          if (!isAgentRunning(pid)) void settleFromPollPath();
        }, pollIntervalMs);
      },
    });

    providerRunPromise
      .then((runResult) => {
        if (!spawnedPid || !isAgentRunning(spawnedPid)) settle(runResult);
      })
      .catch((err) => {
        if (settled) return;
        if (pollInterval) clearInterval(pollInterval);
        settled = true;
        reject(err);
      });
  });
};

/** Reads a JSONL log and infers the process outcome from shared log semantics. */
export const readRunResultFromLog = (logFile: string): RunResult => {
  if (!existsSync(logFile)) {
    return { exitCode: 1 };
  }

  const content = readFileSync(logFile, "utf-8");
  const inferred = inferRunOutcomeFromRawJsonl(content, { requireCompleteLine: true });
  const result: RunResult = {
    exitCode: inferred.outcome === "success" ? 0 : 1,
  };
  const sessionId = sanitizeSessionId(readSessionIdFromRawJsonl(content));
  if (sessionId) {
    result.sessionId = sessionId;
  }
  return result;
};

const waitForProviderRun = async (
  providerRunPromise: Promise<RunResult> | null,
  timeoutMs: number,
): Promise<RunResult | null> => {
  if (!providerRunPromise) return null;

  let timer: Timer | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([providerRunPromise, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const readSessionIdFromRawJsonl = (content: string): string | undefined => {
  let sessionId: string | undefined;

  for (const entry of parseRawJsonlContent(content).entries) {
    const nextSessionId = findSessionId(entry.event);
    if (nextSessionId) {
      sessionId = nextSessionId;
    }
  }

  return sessionId;
};

const findSessionId = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const directSessionId = record.session_id ?? record.sessionId;
  if (typeof directSessionId === "string" && directSessionId.length > 0) {
    return directSessionId;
  }

  for (const nestedValue of Object.values(record)) {
    const nestedSessionId = findSessionId(nestedValue);
    if (nestedSessionId) {
      return nestedSessionId;
    }
  }

  return undefined;
};
