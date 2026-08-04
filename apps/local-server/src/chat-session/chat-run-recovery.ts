import { stat } from "node:fs/promises";
import { getLogger } from "@aop/infra";
import {
  extractRuntimeSessionIdFromRawJsonl,
  parseRawJsonlContent,
  startGrokJournalTail,
} from "@aop/llm-provider";
import type { ChatRun, ChatRunFailureKind, ChatRuntimeSessionState } from "../db/schema.ts";
import { isProviderFailureEvent, isProviderSuccessEvent } from "./provider-event-classifier.ts";
import {
  CHAT_MAX_LOG_BYTES,
  readAssistantTextFromLog,
  readBoundedUtf8File,
} from "./runtime-engine.ts";
import {
  buildChatRuntimeTimeoutFacts,
  resolveChatRuntimeTimeoutPolicy,
} from "./runtime-timeout-policy.ts";
import {
  createStreamProgressAccumulator,
  type StreamProgressListener,
  type StreamProgressSnapshot,
  startLogProgressTail,
} from "./stream-progress.ts";

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
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  getNow?: () => number;
  grokHome?: string;
  signal?: AbortSignal;
}): Promise<RecoveredChatRun> => {
  let logProgress = emptyProgress();
  let nativeProgress = emptyProgress();
  let lastNativeActivityAt = 0;
  const emitProgress = () => input.onProgress?.(mergeProgress(logProgress, nativeProgress));
  const stopTail = input.onProgress
    ? startLogProgressTail({
        logFilePath: input.run.log_file_path,
        onProgress: (progress) => {
          logProgress = progress;
          emitProgress();
        },
      })
    : undefined;
  const nativeTail = startRecoveredGrokJournalTail(input, (progress) => {
    nativeProgress = progress;
    lastNativeActivityAt = Date.now();
    emitProgress();
  });
  try {
    return await pollUntilChatRunTerminal({
      ...input,
      getLastNativeActivityAt: () => lastNativeActivityAt,
    });
  } finally {
    await Promise.all([stopTail?.(), nativeTail?.stop()]);
  }
};

const pollUntilChatRunTerminal = async (input: {
  run: ChatRun;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  getNow?: () => number;
  getLastNativeActivityAt?: () => number;
  signal?: AbortSignal;
}): Promise<RecoveredChatRun> => {
  const pollIntervalMs = input.pollIntervalMs ?? 250;
  const policy = resolveChatRuntimeTimeoutPolicy(input.run.runtime);
  const startupTimeoutMs = input.startupTimeoutMs ?? policy.startupTimeoutMs;
  const inactivityTimeoutMs = input.inactivityTimeoutMs ?? policy.inactivityTimeoutMs;
  const getNow = input.getNow ?? Date.now;
  const runStartedAt = parseActivityTime(input.run.created_at);
  let lastActivityAt = parseActivityTime(input.run.updated_at);
  let lastLogSignature = "";
  let content = "";
  let sawOutput = false;

  while (true) {
    input.signal?.throwIfAborted();
    const poll = await pollRecoveryOnce({
      run: input.run,
      lastLogSignature,
      content,
      sawOutput,
      lastActivityAt,
      runStartedAt,
      startupTimeoutMs,
      inactivityTimeoutMs,
      getNow,
      getLastNativeActivityAt: input.getLastNativeActivityAt,
    });
    lastLogSignature = poll.lastLogSignature;
    content = poll.content;
    sawOutput = poll.sawOutput;
    lastActivityAt = poll.lastActivityAt;
    if (poll.terminal) return poll.terminal;
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
  inactivityTimeoutMs: number;
  getNow: () => number;
  getLastNativeActivityAt?: () => number;
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

  const sawOutput = input.sawOutput || hasRecoveredOutput(input, content);
  const lastActivityAt = Math.max(
    input.lastActivityAt,
    snapshot?.modifiedAt ?? 0,
    input.getLastNativeActivityAt?.() ?? 0,
  );
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
      inactivityTimeoutMs: input.inactivityTimeoutMs,
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

const hasRecoveredOutput = (
  input: { getLastNativeActivityAt?: () => number },
  content: string,
): boolean => content.trim().length > 0 || (input.getLastNativeActivityAt?.() ?? 0) > 0;

const startRecoveredGrokJournalTail = (
  input: {
    run: ChatRun;
    onProgress?: StreamProgressListener;
    grokHome?: string;
  },
  onProgress: (progress: StreamProgressSnapshot) => void,
) => {
  const sessionId = input.run.runtime_session_id ?? input.run.resume_session_id;
  if (
    input.run.runtime !== "grok-build" ||
    !input.onProgress ||
    !input.run.workspace_path ||
    !sessionId
  ) {
    return undefined;
  }
  const accumulator = createStreamProgressAccumulator();
  const toolNames = new Map<string, string>();
  return startGrokJournalTail({
    cwd: input.run.workspace_path,
    sessionId,
    home: input.grokHome,
    onToolProgress: (event) => {
      if (event.name) toolNames.set(event.id, event.name);
      onProgress(
        accumulator.apply({
          kind: "command",
          phase: event.phase,
          command: event.name ?? toolNames.get(event.id) ?? "Tool",
          itemId: `native_${event.id}`,
          detail: event.detail,
          exitCode: event.phase === "done" ? (event.failed ? 1 : 0) : undefined,
        }),
      );
    },
  });
};

const emptyProgress = (): StreamProgressSnapshot => ({
  thinking: "",
  content: "",
  commandGroups: [],
});

const mergeProgress = (
  logProgress: StreamProgressSnapshot,
  nativeProgress: StreamProgressSnapshot,
): StreamProgressSnapshot => ({
  thinking: logProgress.thinking,
  content: logProgress.content,
  commandGroups: [...logProgress.commandGroups, ...nativeProgress.commandGroups],
});

const recoveryTimeoutResult = (input: {
  run: ChatRun;
  content: string;
  sawOutput: boolean;
  now: number;
  runStartedAt: number;
  lastActivityAt: number;
  startupTimeoutMs: number;
  inactivityTimeoutMs: number;
}): RecoveredChatRun | null => {
  if (!input.sawOutput) {
    if (input.now - input.runStartedAt <= input.startupTimeoutMs) return null;
    logRecoveryTimeout(input, "startup", input.now - input.runStartedAt);
    return startupTimeoutResult(input.run, input.content);
  }
  if (input.now - input.lastActivityAt <= input.inactivityTimeoutMs) return null;
  logRecoveryTimeout(input, "inactivity", input.now - input.lastActivityAt);
  return inactivityTimeoutResult(input.run, input.content);
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
  const runtimeSessionState = resolveRecoveredSessionState(run, content, runtimeSessionId);
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

  const text = await readAssistantTextFromLog(run.runtime, run.log_file_path);
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

const startupTimeoutResult = (run: ChatRun, content: string): RecoveredChatRun => ({
  status: "failed",
  text: "The runtime produced no output before the startup deadline. Try again, or reset the runtime session.",
  runtimeSessionId: resolveRecoveredSessionId(run, content),
  runtimeSessionState: resolveRecoveredSessionState(
    run,
    content,
    resolveRecoveredSessionId(run, content),
  ),
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

const inactivityTimeoutResult = (run: ChatRun, content: string): RecoveredChatRun => ({
  status: "failed",
  text: "The runtime stopped responding (inactivity timeout). Try again.",
  runtimeSessionId: resolveRecoveredSessionId(run, content),
  runtimeSessionState: resolveRecoveredSessionState(
    run,
    content,
    resolveRecoveredSessionId(run, content),
  ),
  failureKind: null,
});

const resolveRecoveredSessionState = (
  run: ChatRun,
  content: string,
  runtimeSessionId: string | null,
): ChatRuntimeSessionState | null => {
  if (!runtimeSessionId || run.runtime_session_state !== "allocated") {
    return run.runtime_session_state;
  }
  const hasValidActivity = parseRawJsonlContent(content).entries.some(
    ({ event }) => !isProviderFailureEvent(run.runtime, event),
  );
  return hasValidActivity ? "confirmed" : "allocated";
};
