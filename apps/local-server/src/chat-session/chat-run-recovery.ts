import { stat } from "node:fs/promises";
import { getLogger } from "@aop/infra";
import { extractRuntimeSessionIdFromRawJsonl, parseRawJsonlContent } from "@aop/llm-provider";
import type { ChatRun, ChatRunFailureKind, ChatRuntimeSessionState } from "../db/schema.ts";
import { isProviderFailureEvent, isProviderSuccessEvent } from "./provider-event-classifier.ts";
import {
  CHAT_MAX_LOG_BYTES,
  readAssistantTextFromLog,
  readBoundedUtf8File,
} from "./runtime-engine.ts";
import {
  buildChatRuntimeTimeoutFacts,
  CHAT_RUNTIME_TIMEOUT_POLICY,
} from "./runtime-timeout-policy.ts";
import { type StreamProgressListener, startLogProgressTail } from "./stream-progress.ts";

export type ChatRunTerminalState = "running" | "succeeded" | "failed";
const recoveryLogger = getLogger("aop", "chat-runtime-recovery");

export const detectChatRunTerminalState = (
  runtime: string,
  content: string,
): ChatRunTerminalState => {
  const parsed = parseRawJsonlContent(content);
  if (parsed.hasTrailingPartial) return "running";

  let succeeded = false;
  for (const { event } of parsed.entries) {
    if (isProviderFailureEvent(runtime, event)) return "failed";
    succeeded = succeeded || isProviderSuccessEvent(runtime, event);
  }
  return succeeded ? "succeeded" : "running";
};

export interface RecoveredChatRun {
  status: "completed" | "failed";
  text: string;
  runtimeSessionId: string | null;
  runtimeSessionState: ChatRuntimeSessionState | null;
  failureKind?: ChatRunFailureKind | null;
}

export const waitForChatRunTerminal = async (input: {
  run: ChatRun;
  onProgress?: StreamProgressListener;
  /** True once the run's recorded CLI process has exited (a log without an ending is final). */
  isProcessGone?: () => boolean;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
  getNow?: () => number;
  signal?: AbortSignal;
}): Promise<RecoveredChatRun> => {
  const stopTail = input.onProgress
    ? startLogProgressTail({
        logFilePath: input.run.log_file_path,
        onProgress: input.onProgress,
      })
    : undefined;
  try {
    return await pollUntilChatRunTerminal(input);
  } finally {
    await stopTail?.();
  }
};

const pollUntilChatRunTerminal = async (input: {
  run: ChatRun;
  isProcessGone?: () => boolean;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
  getNow?: () => number;
  signal?: AbortSignal;
}): Promise<RecoveredChatRun> => {
  const pollIntervalMs = input.pollIntervalMs ?? 250;
  const startupTimeoutMs = input.startupTimeoutMs ?? CHAT_RUNTIME_TIMEOUT_POLICY.startupTimeoutMs;
  const getNow = input.getNow ?? Date.now;
  const runStartedAt = parseActivityTime(input.run.created_at);
  let lastActivityAt = parseActivityTime(input.run.updated_at);
  let lastLogSignature = "";
  let content = "";
  let sawOutput = false;

  while (true) {
    input.signal?.throwIfAborted();
    // Sample before reading so a CLI that wrote its ending and exited is read in full.
    const processGone = input.isProcessGone?.() ?? false;
    const poll = await pollRecoveryOnce({
      run: input.run,
      lastLogSignature,
      content,
      sawOutput,
      lastActivityAt,
      runStartedAt,
      startupTimeoutMs,
      getNow,
    });
    lastLogSignature = poll.lastLogSignature;
    content = poll.content;
    sawOutput = poll.sawOutput;
    lastActivityAt = poll.lastActivityAt;
    if (poll.terminal) return poll.terminal;
    if (processGone) return processExitedResult(input.run, content);
    await waitForRecoveryPoll(pollIntervalMs, input.signal);
  }
};

const waitForRecoveryPoll = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) return Bun.sleep(delayMs);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const pollRecoveryOnce = async (input: {
  run: ChatRun;
  lastLogSignature: string;
  content: string;
  sawOutput: boolean;
  lastActivityAt: number;
  runStartedAt: number;
  startupTimeoutMs: number;
  getNow: () => number;
}): Promise<{
  lastLogSignature: string;
  content: string;
  sawOutput: boolean;
  lastActivityAt: number;
  terminal: RecoveredChatRun | null;
}> => {
  const snapshot = await readChangedRecoveryLog(input.run.log_file_path, input.lastLogSignature);
  let { content, lastLogSignature } = input;
  if (snapshot) {
    lastLogSignature = snapshot.signature;
    content = snapshot.content;
    const result = await terminalResult(input.run, content);
    if (result) {
      return {
        lastLogSignature,
        content,
        sawOutput: input.sawOutput,
        lastActivityAt: input.lastActivityAt,
        terminal: result,
      };
    }
  }

  const sawOutput = input.sawOutput || content.trim().length > 0;
  const lastActivityAt = Math.max(input.lastActivityAt, snapshot?.modifiedAt ?? 0);
  return {
    lastLogSignature,
    content,
    sawOutput,
    lastActivityAt,
    terminal: recoveryTimeoutResult({
      run: input.run,
      content,
      sawOutput,
      now: input.getNow(),
      runStartedAt: input.runStartedAt,
      lastActivityAt,
      startupTimeoutMs: input.startupTimeoutMs,
    }),
  };
};

const readChangedRecoveryLog = async (
  logFilePath: string,
  previousSignature: string,
): Promise<{ content: string; modifiedAt: number; signature: string } | null> => {
  const fileStat = await stat(logFilePath).catch(() => null);
  if (!fileStat) return null;
  const signature = `${fileStat.size}:${fileStat.mtimeMs}`;
  if (signature === previousSignature) return null;
  const content = await readBoundedUtf8File(logFilePath, CHAT_MAX_LOG_BYTES);
  if (content === null) return null;
  return { content, modifiedAt: fileStat.mtimeMs, signature };
};

const recoveryTimeoutResult = (input: {
  run: ChatRun;
  content: string;
  sawOutput: boolean;
  now: number;
  runStartedAt: number;
  lastActivityAt: number;
  startupTimeoutMs: number;
}): RecoveredChatRun | null => {
  // A run that already produced output is never declared dead: it may be
  // working quietly for a long time, and recovery must not kill a live runtime.
  if (!input.sawOutput) {
    if (input.now - input.runStartedAt <= input.startupTimeoutMs) return null;
    logRecoveryTimeout(input, "startup", input.now - input.runStartedAt);
    return startupTimeoutResult(input.run, input.content);
  }
  return null;
};

const logRecoveryTimeout = (
  input: Parameters<typeof recoveryTimeoutResult>[0],
  phase: "startup" | "inactivity",
  elapsedMs: number,
): void => {
  recoveryLogger.warn(
    "Recovered chat runtime {phase} timeout",
    buildChatRuntimeTimeoutFacts({
      runtime: input.run.runtime,
      launch: input.run.resume_session_id ? "resume" : "fresh",
      phase,
      elapsedMs,
      outputBytes: new TextEncoder().encode(input.content).byteLength,
      sessionIdKnown: Boolean(
        input.run.runtime_session_id ||
          input.run.resume_session_id ||
          extractRuntimeSessionIdFromRawJsonl(input.content),
      ),
    }),
  );
};

const terminalResult = async (run: ChatRun, content: string): Promise<RecoveredChatRun | null> => {
  const terminal = detectChatRunTerminalState(run.runtime, content);
  const runtimeSessionId = resolveRecoveredSessionId(run, content);
  const runtimeSessionState = run.runtime_session_state;
  if (terminal === "failed") {
    return {
      status: "failed",
      text: "Runtime failed before producing a final response.",
      runtimeSessionId,
      runtimeSessionState,
      failureKind: null,
    };
  }
  if (terminal !== "succeeded") return null;

  const text = await readAssistantTextFromLog(run.log_file_path);
  if (!text.trim()) {
    return {
      status: "failed",
      text: "The runtime finished without producing a response. Try again, or reset the runtime session.",
      runtimeSessionId,
      runtimeSessionState,
      failureKind: "empty_output",
    };
  }

  return {
    status: "completed",
    text,
    runtimeSessionId,
    runtimeSessionState,
    failureKind: null,
  };
};

const parseActivityTime = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const processExitedResult = (run: ChatRun, content: string): RecoveredChatRun => {
  recoveryLogger.warn("Recovered chat runtime {runId} exited without a final response", {
    runId: run.id,
    pid: run.pid,
  });
  return {
    status: "failed",
    text: "The runtime process exited without a final response. Try again, or reset the runtime session.",
    runtimeSessionId: resolveRecoveredSessionId(run, content),
    runtimeSessionState: run.runtime_session_state,
    failureKind: null,
  };
};

const startupTimeoutResult = (run: ChatRun, content: string): RecoveredChatRun => ({
  status: "failed",
  text: "The runtime produced no output before the startup deadline. Try again, or reset the runtime session.",
  runtimeSessionId: resolveRecoveredSessionId(run, content),
  runtimeSessionState: run.runtime_session_state,
  failureKind: "startup_timeout",
});

const resolveRecoveredSessionId = (run: ChatRun, content: string): string | null => {
  const logSessionId = extractRuntimeSessionIdFromRawJsonl(content);
  if (logSessionId && run.runtime_session_id && logSessionId !== run.runtime_session_id) {
    throw new Error(
      `Runtime session invariant violated for ${run.id}: durable ${run.runtime_session_id}, log ${logSessionId}`,
    );
  }
  return logSessionId ?? run.runtime_session_id ?? run.resume_session_id;
};
