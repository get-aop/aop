import { createHash } from "node:crypto";
import { type FSWatcher, readFileSync, watch } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { AOP_PORTS, type ControlCommand } from "@aop/common";
import { aopPaths, getLogger } from "@aop/infra";
import {
  createProvider,
  extractAssistantSignalTextFromRawJsonl,
  extractFinalAssistantTextFromRawJsonl,
  extractLastGrokTextRunFromRawJsonl,
  extractRuntimeSessionIdFromRawJsonl,
  hasUnfinishedGrokTools,
  type LLMProvider,
  listDescendantPids,
  needsControlProcessCleanup,
  parseRawJsonlContent,
  type RunOptions,
  type RunToolProgress,
  terminateProcessTree,
} from "@aop/llm-provider";
import type { ChatRuntimeSessionState, ChatSession } from "../db/schema.ts";
import { createAuthenticatedMcpUrl } from "../mcp/auth.ts";
import { isMcpCapableRuntime } from "../mcp/routes.ts";
import { isProviderFailureEvent } from "./provider-event-classifier.ts";
import {
  createRuntimeSessionLineInspector,
  startRuntimeSessionTail,
} from "./runtime-session-tail.ts";
import {
  buildChatRuntimeTimeoutFacts,
  resolveChatRuntimeTimeoutPolicy,
} from "./runtime-timeout-policy.ts";
import {
  type ActiveRunHandle,
  beginSessionRunExecution,
  type InterruptReason,
  releaseSessionRunExecution,
  type SessionRunRegistration,
} from "./session-run-lifecycle.ts";
import {
  createStreamProgressAccumulator,
  type StreamProgressListener,
  type StreamProgressSnapshot,
  startLogProgressTail,
} from "./stream-progress.ts";

export {
  type ActiveRunPhase,
  activeSessionRunIds,
  interruptSessionRun,
  isSessionRunActive,
  isSessionRunInterrupted,
  isSessionToolActive,
  ownsSessionRunRegistration,
  registerPendingSessionRun,
  releaseSessionRunRegistration,
  type SessionRunRegistration,
  sessionRunPhase,
} from "./session-run-lifecycle.ts";

export type CreateProviderFn = (key: string) => LLMProvider;
export type RuntimeControl = Pick<ControlCommand, "provider" | "capability">;

/** Chat live runs share durable recovery timeouts for consistent UX. */
export const CHAT_STARTUP_TIMEOUT_MS = 30_000;
export const CHAT_INACTIVITY_TIMEOUT_MS = 5 * 60_000;
/**
 * Soft size for the AOP capture log (provider stdout). Like t3code observability
 * logs: warn when exceeded, never kill the agent. Finalization reads at most this
 * many trailing bytes so huge logs cannot OOM the server.
 */
export const CHAT_MAX_LOG_BYTES = 64 * 1024 * 1024;
const CHAT_LOG_SIZE_POLL_MS = 500;

/**
 * Read at most `maxBytes` from the end of a UTF-8 log file.
 * When larger, drops a partial first line only when the cut lands mid-line.
 * Returns null when missing or on read failure (recovery can retry).
 */
export const readBoundedUtf8File = async (
  path: string,
  maxBytes: number,
): Promise<string | null> => {
  if (maxBytes < 1) return "";
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat) return null;
  if (fileStat.size <= 0) return "";
  if (fileStat.size <= maxBytes) {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  }
  return readUtf8FileTail(path, fileStat.size, maxBytes);
};

const readUtf8FileTail = async (
  path: string,
  fileSize: number,
  maxBytes: number,
): Promise<string | null> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const start = fileSize - maxBytes;
    const startsMidLine = await byteBeforeIsNotNewline(handle, start);
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, start);
    return trimPartialLeadingLine(buffer.subarray(0, bytesRead).toString("utf8"), startsMidLine);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

const byteBeforeIsNotNewline = async (
  handle: Awaited<ReturnType<typeof open>>,
  start: number,
): Promise<boolean> => {
  if (start <= 0) return false;
  const previous = Buffer.alloc(1);
  const { bytesRead } = await handle.read(previous, 0, 1, start - 1);
  return bytesRead === 1 && previous[0] !== 0x0a;
};

const trimPartialLeadingLine = (text: string, startsMidLine: boolean): string => {
  if (!startsMidLine) return text;
  const firstNewline = text.indexOf("\n");
  if (firstNewline < 0) return "";
  return text.slice(firstNewline + 1);
};

export interface RuntimeRunResult {
  text: string;
  runtimeSessionId: string | null;
  artifacts?: ChatFileArtifact[];
  timedOut?: boolean;
  startupTimedOut?: boolean;
  failed?: boolean;
  /** True when the run was stopped by a mid-run steer. */
  interrupted?: boolean;
  /** True when the user explicitly stopped the conversation. */
  aborted?: boolean;
  interruptionKind?: "steer" | "abort" | "reset" | "output_limit";
  /** Structured empty-output classification when the run failed for silence/empty text. */
  failureKind?: "startup_timeout" | "empty_output";
  /** Native binding rejected by the provider and requiring an orchestrated fresh launch. */
  staleRuntimeSessionId?: string;
  runtimeSessionState?: ChatRuntimeSessionState;
  /** Clear the chat binding while retaining the run's runtime id for diagnostics. */
  bindingPolicy?: "clear";
}

export interface ChatFileArtifact {
  path: string;
  mimeType: "text/markdown";
}

const runtimeLogger = getLogger("aop", "chat-runtime");

export const runSessionPrompt = async (input: {
  session: ChatSession;
  repoPath: string;
  prompt: string;
  registration?: SessionRunRegistration;
  /** A one-turn provider-native browser or computer capability. */
  control?: RuntimeControl;
  /** Extra dirs the provider may read (e.g. chat image attachments). */
  allowedDirectories?: string[];
  /** Durable path allocated before launch so a reloaded server can resume the run. */
  logFilePath?: string;
  createProviderFn?: CreateProviderFn;
  onProgress?: StreamProgressListener;
  newSessionId?: string;
  onRuntimeSession?: (sessionId: string) => Promise<void> | void;
  /** Test seam; production uses CHAT_MAX_LOG_BYTES. */
  maxLogBytes?: number;
  /** Test seam; production uses CHAT_LOG_SIZE_POLL_MS. */
  logSizePollMs?: number;
}): Promise<RuntimeRunResult> => {
  const { session, repoPath, prompt } = input;
  const execution = beginSessionRunExecution(session.id, session.runtime, input.registration);
  if (!execution) {
    return {
      text: "A run is already in progress for this session — wait for it to finish.",
      runtimeSessionId: session.runtime_session_id,
      failed: true,
    };
  }

  const { owner, handle } = execution;
  const artifactTracker = startMarkdownArtifactTracker(repoPath);
  try {
    if (owner.interrupted) return interruptedRunResult(handle, session.runtime_session_id);
    if (
      isGrokRuntime(session.runtime) &&
      session.runtime_session_id &&
      (await hasUnfinishedGrokTools({
        cwd: repoPath,
        sessionId: session.runtime_session_id,
      }))
    ) {
      return {
        text: "The saved Grok session ended during a tool call. Rebuilding context in a fresh session.",
        runtimeSessionId: session.runtime_session_id,
        staleRuntimeSessionId: session.runtime_session_id,
        failed: true,
      };
    }

    const result = await executeProviderRun(
      session,
      repoPath,
      prompt,
      input.control,
      input.allowedDirectories,
      input.logFilePath,
      input.createProviderFn,
      input.onProgress,
      input.newSessionId,
      input.onRuntimeSession,
      handle,
      input.maxLogBytes,
      input.logSizePollMs,
    );
    return {
      ...result,
      artifacts: await artifactTracker.finish(),
    };
  } finally {
    artifactTracker.close();
    releaseSessionRunExecution(session.id, execution);
  }
};

interface MarkdownArtifactTracker {
  finish: () => Promise<ChatFileArtifact[]>;
  close: () => void;
}

interface MarkdownWorkspaceState {
  head: string | null;
  files: Map<string, string>;
}

const startMarkdownArtifactTracker = (repoPath: string): MarkdownArtifactTracker => {
  const paths = new Set<string>();
  const baseline = captureMarkdownWorkspaceState(repoPath);
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(repoPath, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const path = String(filename);
      if (isSafeMarkdownArtifactPath(repoPath, path)) paths.add(path);
    });
  } catch {
    // Text-reference detection remains the fallback when the platform cannot watch recursively.
  }

  const close = () => {
    watcher?.close();
    watcher = null;
  };
  return {
    close,
    finish: async () => {
      const current = captureMarkdownWorkspaceState(repoPath);
      for (const path of await changedMarkdownPathsSince(repoPath, baseline, current)) {
        paths.add(path);
      }
      close();
      const artifacts = await Promise.all(
        [...paths].sort().map(async (path) => {
          const absolutePath = resolve(repoPath, path);
          try {
            await readFile(absolutePath);
            return { path: absolutePath, mimeType: "text/markdown" as const };
          } catch {
            return null;
          }
        }),
      );
      return artifacts.filter((artifact): artifact is ChatFileArtifact => artifact !== null);
    },
  };
};

const captureMarkdownWorkspaceState = (repoPath: string): MarkdownWorkspaceState => {
  const head = gitTextSync(repoPath, ["rev-parse", "HEAD"]);
  const status = gitTextSync(repoPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    "*.md",
  ]);
  const paths = (status ?? "")
    .split("\0")
    .filter((entry) => entry.length > 3 && entry[2] === " ")
    .map((entry) => entry.slice(3));
  const fingerprints = paths.flatMap((path) => {
    const fingerprint = fileFingerprint(resolve(repoPath, path));
    return fingerprint ? ([[path, fingerprint]] as const) : [];
  });
  return {
    head: head?.trim() || null,
    files: new Map(fingerprints),
  };
};

const changedMarkdownPathsSince = async (
  repoPath: string,
  initial: MarkdownWorkspaceState,
  current: MarkdownWorkspaceState,
): Promise<string[]> => {
  const committedPaths =
    initial.head && current.head && initial.head !== current.head
      ? await gitPaths(repoPath, [
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--name-only",
          "-z",
          initial.head,
          current.head,
          "--",
          "*.md",
        ])
      : [];
  const workingPaths = [...current.files].flatMap(([path, fingerprint]) =>
    initial.files.get(path) === fingerprint ? [] : [path],
  );
  return [...new Set([...committedPaths, ...workingPaths])];
};

const gitPaths = async (repoPath: string, args: string[]): Promise<string[]> => {
  const output = await gitText(repoPath, args);
  return output ? output.split("\0").filter(Boolean) : [];
};

const gitText = async (repoPath: string, args: string[]): Promise<string | null> => {
  const process = Bun.spawn(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  return exitCode === 0 ? stdout : null;
};

const gitTextSync = (repoPath: string, args: string[]): string | null => {
  const result = Bun.spawnSync(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 ? result.stdout.toString() : null;
};

const fileFingerprint = (path: string): string | null => {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
};

const isSafeMarkdownArtifactPath = (repoPath: string, path: string): boolean => {
  const relativePath = relative(repoPath, resolve(repoPath, path));
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !relativePath.startsWith("/") &&
    extname(relativePath).toLowerCase() === ".md"
  );
};

const executeProviderRun = async (
  session: ChatSession,
  repoPath: string,
  prompt: string,
  control: RuntimeControl | undefined,
  allowedDirectories: string[] | undefined,
  durableLogFilePath: string | undefined,
  createProviderFn: CreateProviderFn | undefined,
  onProgress: StreamProgressListener | undefined,
  newSessionId: string | undefined,
  onRuntimeSession: ((sessionId: string) => Promise<void> | void) | undefined,
  handle: ActiveRunHandle,
  maxLogBytes = CHAT_MAX_LOG_BYTES,
  logSizePollMs = CHAT_LOG_SIZE_POLL_MS,
): Promise<RuntimeRunResult> => {
  let capturedSessionId: string | null = session.runtime_session_id;
  let stopTail: (() => Promise<void>) | undefined;
  let stopSessionTail: (() => Promise<void>) | undefined;
  let stopLogSizeWatchdog: (() => void) | undefined;
  let resolveInterrupt: ((result: RuntimeRunResult) => void) | undefined;
  let providerSettled: Promise<void> | null = null;
  let interruptionStarted = false;
  let logProgress = emptyProgressSnapshot();
  let nativeProgress = emptyProgressSnapshot();
  const nativeAccumulator = createStreamProgressAccumulator();
  const activeNativeTools = new Set<string>();
  const nativeToolNames = new Map<string, string>();
  const reportedRuntimeSessionIds = new Set<string>();
  const runtimeSessionReports = new Map<string, Promise<void>>();
  if (capturedSessionId) reportedRuntimeSessionIds.add(capturedSessionId);
  const captureRuntimeSession = async (id: string): Promise<void> => {
    // Keep the in-memory capture so finalization can record the id on the run even
    // when durable session binding is blocked. Finalization re-applies the binding
    // invariant and will not overwrite a different existing session binding.
    capturedSessionId = id;
    if (reportedRuntimeSessionIds.has(id)) return;
    const existing = runtimeSessionReports.get(id);
    if (existing) {
      await existing.catch(() => undefined);
      return;
    }

    const report = Promise.resolve(onRuntimeSession?.(id))
      .then(() => {
        reportedRuntimeSessionIds.add(id);
      })
      .catch(() => {
        // Transient failures stay unreported so a later observation can retry.
        // Binding conflicts also stay unreported; session overwrite is blocked at
        // finalization rather than failing the whole provider run.
      })
      .finally(() => {
        if (runtimeSessionReports.get(id) === report) runtimeSessionReports.delete(id);
      });
    runtimeSessionReports.set(id, report);
    await report;
  };

  const emitProgress = () => {
    onProgress?.(mergeProgressSnapshots(logProgress, nativeProgress));
  };
  const onNativeToolProgress = (event: RunToolProgress) => {
    if (event.phase === "done") activeNativeTools.delete(event.id);
    else activeNativeTools.add(event.id);
    handle.nativeToolActive = activeNativeTools.size > 0;
    if (!onProgress) return;
    if (event.name) nativeToolNames.set(event.id, event.name);
    nativeProgress = nativeAccumulator.apply({
      kind: "command",
      phase: event.phase,
      command: event.name ?? nativeToolNames.get(event.id) ?? "Tool",
      itemId: `native_${event.id}`,
      detail: event.detail,
      exitCode: event.phase === "done" ? (event.failed ? 1 : 0) : undefined,
    });
    emitProgress();
  };

  // Wire interrupt before any await so early steers still resolve the race.
  const interruptPromise = new Promise<RuntimeRunResult>((resolve) => {
    resolveInterrupt = resolve;
  });
  const resolveInterruptedRun = async (logFilePath?: string): Promise<void> => {
    const logSessionId = logFilePath ? await readRuntimeSessionIdFromLog(logFilePath) : null;
    resolveInterrupt?.(
      interruptedRunResult(handle, logSessionId ?? capturedSessionId, logSessionId),
    );
  };
  const interruptAfterProviderExit = (logFilePath?: string): void => {
    if (interruptionStarted) return;
    interruptionStarted = true;
    void (async () => {
      await stopProvider(handle, providerSettled);
      await resolveInterruptedRun(logFilePath);
    })();
  };
  handle.kill = () => interruptAfterProviderExit();
  if (handle.owner.interrupted) return interruptedRunResult(handle, capturedSessionId);

  try {
    const prepared = await prepareProviderLaunch({
      session,
      createProviderFn,
      durableLogFilePath,
      handle,
      interruptAfterProviderExit,
      capturedSessionId,
    });
    if (!("provider" in prepared)) return prepared;
    const { provider, logFilePath } = prepared;
    // Capture logs are best-effort observability (t3code-style): warn when huge,
    // never cancel the provider. Finalization only reads a bounded tail of this file.
    stopLogSizeWatchdog = startSessionLogSizeWatchdog({
      logFilePath,
      maxBytes: maxLogBytes,
      pollMs: logSizePollMs,
      onExceeded: () => {
        runtimeLogger.warn("Chat runtime capture log exceeded soft size; continuing run", {
          runtime: session.runtime,
          sessionId: session.id,
          maxBytes: maxLogBytes,
        });
      },
    });
    if (onProgress) {
      const inspectSessionLine = createRuntimeSessionLineInspector({
        runtime: session.runtime,
        newSessionId,
        onSession: captureRuntimeSession,
      });
      stopTail = startLogProgressTail({
        logFilePath,
        onLine: async (line) => {
          await inspectSessionLine(line);
        },
        onProgress: (progress) => {
          logProgress = progress;
          handle.logToolActive = hasRunningTool(progress);
          emitProgress();
        },
      });
    } else {
      stopSessionTail = startRuntimeSessionTail({
        runtime: session.runtime,
        logFilePath,
        newSessionId,
        onSession: captureRuntimeSession,
      });
    }

    return await raceProviderAgainstInterrupt({
      session,
      repoPath,
      prompt,
      control,
      allowedDirectories,
      logFilePath,
      provider,
      handle,
      captureRuntimeSession,
      newSessionId,
      onNativeToolProgress,
      getCapturedSessionId: () => capturedSessionId,
      setProviderSettled: (settled) => {
        providerSettled = settled;
      },
      interruptPromise,
    });
  } catch (error) {
    return providerFailureResult(error, handle, capturedSessionId);
  } finally {
    stopLogSizeWatchdog?.();
    await stopSessionTail?.();
    await stopTail?.();
  }
};

const prepareProviderLaunch = async (input: {
  session: ChatSession;
  createProviderFn: CreateProviderFn | undefined;
  durableLogFilePath: string | undefined;
  handle: ActiveRunHandle;
  interruptAfterProviderExit: (logFilePath?: string) => void;
  capturedSessionId: string | null;
}): Promise<{ provider: LLMProvider; logFilePath: string } | RuntimeRunResult> => {
  if (input.handle.owner.interrupted) {
    return interruptedRunResult(input.handle, input.capturedSessionId);
  }
  const factory = input.createProviderFn ?? createProvider;
  const provider = factory(resolveSessionProviderKey(input.session));
  if (input.handle.owner.interrupted) {
    return interruptedRunResult(input.handle, input.capturedSessionId);
  }
  input.handle.interruptSignal = provider.interruptSignal ?? "SIGTERM";
  const logFilePath = input.durableLogFilePath ?? (await createSessionRunLogPath(input.session.id));
  if (input.handle.owner.interrupted) {
    return interruptedRunResult(input.handle, input.capturedSessionId);
  }
  input.handle.kill = () => input.interruptAfterProviderExit(logFilePath);
  return { provider, logFilePath };
};

const raceProviderAgainstInterrupt = async (input: {
  session: ChatSession;
  repoPath: string;
  prompt: string;
  control: RuntimeControl | undefined;
  allowedDirectories: string[] | undefined;
  logFilePath: string;
  provider: LLMProvider;
  handle: ActiveRunHandle;
  captureRuntimeSession: (id: string) => Promise<void>;
  newSessionId: string | undefined;
  onNativeToolProgress: (event: RunToolProgress) => void;
  getCapturedSessionId: () => string | null;
  setProviderSettled: (settled: Promise<void>) => void;
  interruptPromise: Promise<RuntimeRunResult>;
}): Promise<RuntimeRunResult> => {
  if (input.handle.owner.interrupted) {
    return interruptedRunResult(input.handle, input.getCapturedSessionId());
  }
  const options = buildRunOptions(
    input.session,
    input.repoPath,
    input.prompt,
    input.control,
    input.captureRuntimeSession,
    input.logFilePath,
    input.allowedDirectories,
    (pid) => {
      input.handle.pid = pid;
      input.handle.resolvePid(pid);
      input.handle.phase = input.handle.owner.interrupted ? "cancelling" : "running";
    },
    input.newSessionId,
    input.onNativeToolProgress,
  );
  const providerPromise = completeProviderRun({
    runtime: input.session.runtime,
    provider: input.provider,
    options,
    logFilePath: input.logFilePath,
    handle: input.handle,
    getCapturedSessionId: input.getCapturedSessionId,
    captureRuntimeSession: input.captureRuntimeSession,
  });
  input.setProviderSettled(
    providerPromise.then(
      () => undefined,
      () => undefined,
    ),
  );
  if (input.handle.owner.interrupted) input.handle.kill();
  void providerPromise.catch(() => undefined);
  const result = await Promise.race([providerPromise, input.interruptPromise]);
  return input.handle.owner.interrupted ? await input.interruptPromise : result;
};

const completeProviderRun = async (input: {
  runtime: string;
  provider: LLMProvider;
  options: RunOptions;
  logFilePath: string;
  handle: ActiveRunHandle;
  getCapturedSessionId: () => string | null;
  captureRuntimeSession: (sessionId: string) => Promise<void>;
}): Promise<RuntimeRunResult> => {
  const providerStartedAt = Date.now();
  // Control turns leave native helpers (Codex computer_use mouse, Playwright MCP).
  // Snapshot while the root is alive so cleanup still finds reparented orphans.
  const controlGuard = beginControlProcessGuard(input.handle, input.options);
  try {
    const result = await input.provider.run(input.options);
    return await finalizeCompletedProviderRun({ ...input, result, providerStartedAt });
  } finally {
    await controlGuard.stop();
  }
};

const beginControlProcessGuard = (
  handle: ActiveRunHandle,
  options: RunOptions,
): { stop: () => Promise<void> } => {
  if (!needsControlProcessCleanup(options)) {
    return { stop: async () => undefined };
  }
  const knownDescendants = new Set<number>();
  const timer = setInterval(() => {
    const pid = handle.pid;
    if (!pid) return;
    for (const child of listDescendantPids(pid)) knownDescendants.add(child);
  }, 50);
  return {
    stop: async () => {
      clearInterval(timer);
      const pid = handle.pid;
      if (!pid) return;
      for (const child of listDescendantPids(pid)) knownDescendants.add(child);
      await terminateProcessTree(pid, knownDescendants);
    },
  };
};

const finalizeCompletedProviderRun = async (input: {
  runtime: string;
  options: RunOptions;
  logFilePath: string;
  handle: ActiveRunHandle;
  getCapturedSessionId: () => string | null;
  captureRuntimeSession: (sessionId: string) => Promise<void>;
  result: Awaited<ReturnType<LLMProvider["run"]>>;
  providerStartedAt: number;
}): Promise<RuntimeRunResult> => {
  if (
    await shouldStartFreshCodexThread(input.runtime, input.options, input.result, input.logFilePath)
  ) {
    return {
      text: "The saved Codex thread is no longer available. Rebuilding context in a fresh thread.",
      runtimeSessionId: input.getCapturedSessionId(),
      staleRuntimeSessionId: input.options.resumeSessionId,
      failed: true,
    };
  }

  const resolvedSessionId =
    input.result.sessionId ?? (await readRuntimeSessionIdFromLog(input.logFilePath));
  if (resolvedSessionId) await input.captureRuntimeSession(resolvedSessionId);
  const capturedSessionId = input.getCapturedSessionId();
  if (input.handle.owner.interrupted) {
    return interruptedRunResult(input.handle, capturedSessionId, capturedSessionId);
  }

  await logLiveTimeout({
    runtime: input.runtime,
    launch: input.options.resumeSessionId ? "resume" : "fresh",
    result: input.result,
    logFilePath: input.logFilePath,
    startedAt: input.providerStartedAt,
    sessionIdKnown: Boolean(capturedSessionId),
  });
  return interpretRunResult(input.runtime, input.result, input.logFilePath, capturedSessionId);
};

const providerFailureResult = (
  error: unknown,
  handle: ActiveRunHandle,
  runtimeSessionId: string | null,
): RuntimeRunResult => {
  if (handle.owner.interrupted) return interruptedRunResult(handle, runtimeSessionId);
  const message = error instanceof Error ? error.message : String(error);
  return { text: `Runtime error: ${message}`, runtimeSessionId, failed: true };
};

const interruptedRunResult = (
  handle: ActiveRunHandle,
  runtimeSessionId: string | null,
  confirmedSessionId: string | null = null,
): RuntimeRunResult => ({
  text: interruptedText(handle.owner.interruptReason),
  runtimeSessionId,
  runtimeSessionState: confirmedSessionId ? "confirmed" : undefined,
  interrupted: true,
  aborted: handle.owner.interruptReason !== "steer",
  interruptionKind: handle.owner.interruptReason,
  ...(isGrokRuntime(handle.owner.runtime) && handle.owner.interruptedDuringTool
    ? { bindingPolicy: "clear" as const }
    : {}),
});

const stopProvider = async (
  handle: ActiveRunHandle,
  providerSettled: Promise<void> | null,
): Promise<void> => {
  let pid = handle.pid;
  if (pid === undefined) {
    if (!providerSettled) return;
    const spawned = await Promise.race([
      handle.pidReady.then((spawnedPid) => ({ pid: spawnedPid })),
      providerSettled.then(() => null),
    ]);
    if (!spawned) return;
    pid = spawned.pid;
  }

  const target = createProviderProcessTarget(pid);
  signalProvider(target, handle.interruptSignal);
  const exitedAfterInterrupt = await waitUntilProviderExited(target, providerSettled, 1_500);
  if (exitedAfterInterrupt) return;
  if (handle.interruptSignal !== "SIGTERM") {
    signalProvider(target, "SIGTERM");
    const exitedAfterTerm = await waitUntilProviderExited(target, providerSettled, 1_000);
    if (exitedAfterTerm) return;
  }
  signalProvider(target, "SIGKILL");
  await waitUntilProviderExited(target, providerSettled);
};

interface ProviderProcessTarget {
  rootPid: number;
  descendantPids: Set<number>;
}

const createProviderProcessTarget = (rootPid: number): ProviderProcessTarget => {
  const descendantPids = new Set(descendantProcessIds(rootPid));
  return { rootPid, descendantPids };
};

const waitUntilProviderExited = async (
  target: ProviderProcessTarget,
  providerSettled: Promise<void> | null,
  timeoutMs?: number,
): Promise<boolean> => {
  const startedAt = Date.now();
  let providerHasSettled = false;
  void providerSettled?.then(() => {
    providerHasSettled = true;
  });
  while (providerTargetIsAlive(target, providerHasSettled)) {
    if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) return false;
    await Bun.sleep(25);
  }
  return true;
};

const providerTargetIsAlive = (
  target: ProviderProcessTarget,
  providerHasSettled: boolean,
): boolean => {
  if (!providerHasSettled && isProviderProcessAlive(target.rootPid)) {
    for (const pid of descendantProcessIds(target.rootPid)) target.descendantPids.add(pid);
  }
  for (const pid of target.descendantPids) {
    if (isPidAlive(pid)) return true;
  }
  return !providerHasSettled && isProviderProcessAlive(target.rootPid);
};

const isProviderProcessAlive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
};

const signalProvider = (target: ProviderProcessTarget, signal: NodeJS.Signals): void => {
  for (const descendant of descendantProcessIds(target.rootPid)) {
    target.descendantPids.add(descendant);
  }
  for (const descendant of target.descendantPids) {
    try {
      process.kill(descendant, signal);
    } catch {
      // The child exited between process discovery and signaling.
    }
  }
  try {
    process.kill(-target.rootPid, signal);
  } catch {
    try {
      process.kill(target.rootPid, signal);
    } catch {
      // The process exited between observation and signaling.
    }
  }
};

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const descendantProcessIds = (rootPid: number): number[] => {
  if (process.platform === "win32") return [];
  const snapshot = Bun.spawnSync(["ps", "-axo", "pid=,ppid="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (snapshot.exitCode !== 0) return [];

  const children = new Map<number, number[]>();
  for (const line of snapshot.stdout.toString().split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/);
    const pid = Number.parseInt(pidText ?? "", 10);
    const parent = Number.parseInt(parentText ?? "", 10);
    if (!Number.isFinite(pid) || !Number.isFinite(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }

  const descendants: number[] = [];
  const visit = (parent: number) => {
    for (const child of children.get(parent) ?? []) {
      visit(child);
      descendants.push(child);
    }
  };
  visit(rootPid);
  return descendants;
};

/** Soft log-size monitor: fires once when over maxBytes, never kills the run. */
const startSessionLogSizeWatchdog = ({
  logFilePath,
  maxBytes,
  pollMs,
  onExceeded,
}: {
  logFilePath: string;
  maxBytes: number;
  pollMs: number;
  onExceeded: () => void;
}): (() => void) => {
  let stopped = false;
  let checking = false;
  let exceeded = false;
  const check = async () => {
    if (stopped || checking || exceeded) return;
    checking = true;
    try {
      const size = await stat(logFilePath)
        .then((value) => value.size)
        .catch(() => 0);
      if (!stopped && size > maxBytes) {
        exceeded = true;
        onExceeded();
      }
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void check(), pollMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
};

const logLiveTimeout = async (input: {
  runtime: string;
  launch: "fresh" | "resume";
  result: { timedOut?: boolean; startupTimedOut?: boolean };
  logFilePath: string;
  startedAt: number;
  sessionIdKnown: boolean;
}): Promise<void> => {
  const phase = input.result.startupTimedOut
    ? "startup"
    : input.result.timedOut
      ? "inactivity"
      : null;
  if (!phase) return;
  const outputBytes = await stat(input.logFilePath)
    .then((value) => value.size)
    .catch(() => 0);
  runtimeLogger.warn(
    "Chat runtime {phase} timeout",
    buildChatRuntimeTimeoutFacts({
      runtime: input.runtime,
      launch: input.launch,
      phase,
      elapsedMs: Date.now() - input.startedAt,
      outputBytes,
      sessionIdKnown: input.sessionIdKnown,
    }),
  );
};

const shouldStartFreshCodexThread = async (
  runtime: string,
  options: RunOptions,
  result: { exitCode: number },
  logFilePath: string,
): Promise<boolean> => {
  if (runtime !== "codex-cli" || !options.resumeSessionId || result.exitCode === 0) return false;
  const error = await readRuntimeErrorFromLog(logFilePath, runtime);
  return error?.includes("no rollout found for thread id") === true;
};

const interruptedText = (reason: InterruptReason): string =>
  reason === "output_limit"
    ? "Run stopped after reaching the safe output limit."
    : reason === "steer"
      ? "Interrupted — applying your next message."
      : reason === "reset"
        ? "Runtime session reset. The next message will start a fresh runtime session."
        : "Conversation stopped.";

const buildRunOptions = (
  session: ChatSession,
  repoPath: string,
  prompt: string,
  control: RuntimeControl | undefined,
  onSession: (id: string) => Promise<void> | void,
  logFilePath: string,
  allowedDirectories?: string[],
  onSpawn?: (pid: number) => void,
  newSessionId?: string,
  onToolProgress?: (event: RunToolProgress) => void,
): RunOptions => {
  const nativeControl = control?.provider === session.runtime ? control : undefined;
  const timeoutPolicy = resolveChatRuntimeTimeoutPolicy(session.runtime);
  return {
    prompt,
    cwd: repoPath,
    isolation: "open",
    model: session.model,
    reasoningEffort: session.reasoning_effort,
    fastMode: Boolean(session.fast_mode),
    accessMode: session.runtime_access_mode ?? "full-access",
    browserControl: nativeControl?.capability === "browser",
    computerControl: nativeControl?.capability === "computer",
    runtimeAlias: session.runtime_alias ?? undefined,
    resumeSessionId: session.runtime_session_id ?? undefined,
    newSessionId,
    logFilePath,
    onSession,
    onSpawn,
    onToolProgress,
    allowedDirectories,
    mcpServerUrl: resolveAopMcpUrl(session.runtime, session.id),
    startupTimeoutMs: timeoutPolicy.startupTimeoutMs,
    inactivityTimeoutMs: timeoutPolicy.inactivityTimeoutMs,
    env: {
      AOP_CHAT_SESSION_ID: session.id,
      AOP_CHAT_WORKSPACE_PATH: repoPath,
    },
  };
};

const emptyProgressSnapshot = (): StreamProgressSnapshot => ({
  thinking: "",
  content: "",
  commandGroups: [],
});

const mergeProgressSnapshots = (
  logProgress: StreamProgressSnapshot,
  nativeProgress: StreamProgressSnapshot,
): StreamProgressSnapshot => ({
  thinking: logProgress.thinking,
  content: logProgress.content,
  commandGroups: [
    ...logProgress.commandGroups,
    ...nativeProgress.commandGroups.map((group) => ({
      ...group,
      id: `native_${group.id}`,
    })),
  ],
});

const hasRunningTool = (progress: StreamProgressSnapshot): boolean =>
  progress.commandGroups.some((group) =>
    group.commands.some((command) => command.status === "running"),
  );

/** Per-provider capability flag: only MCP-capable CLIs receive the aop endpoint. */
export const resolveAopMcpUrl = (runtime: string, chatSessionId: string): string | undefined => {
  if (!isMcpCapableRuntime(runtime)) return undefined;
  if (process.env.AOP_MCP_URL?.trim()) {
    return createAuthenticatedMcpUrl(process.env.AOP_MCP_URL.trim(), chatSessionId);
  }
  // Prefer explicit env; avoid throwing when AOP_PORTS.LOCAL_SERVER is unset in unit tests.
  const raw = process.env.PORT ?? process.env.AOP_LOCAL_SERVER_PORT;
  const port = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(port) || port <= 0) {
    try {
      return createAuthenticatedMcpUrl(
        `http://127.0.0.1:${AOP_PORTS.LOCAL_SERVER}/api/mcp`,
        chatSessionId,
      );
    } catch {
      return undefined;
    }
  }
  return createAuthenticatedMcpUrl(`http://127.0.0.1:${port}/api/mcp`, chatSessionId);
};

const interpretRunResult = async (
  runtime: string,
  result: {
    exitCode: number;
    sessionId?: string;
    completedFromSessionEvent?: boolean;
    timedOut?: boolean;
    startupTimedOut?: boolean;
  },
  logFilePath: string,
  capturedSessionId: string | null,
): Promise<RuntimeRunResult> => {
  if (!result.completedFromSessionEvent && result.startupTimedOut) {
    return {
      text: "The runtime produced no output before the startup deadline. Try again, or reset the runtime session.",
      runtimeSessionId: capturedSessionId,
      startupTimedOut: true,
      failed: true,
      failureKind: "startup_timeout",
    };
  }

  if (!result.completedFromSessionEvent && result.timedOut) {
    return {
      text: "The runtime stopped responding (inactivity timeout). Try again, or switch model/effort.",
      runtimeSessionId: capturedSessionId,
      timedOut: true,
      failed: true,
    };
  }

  if (!result.completedFromSessionEvent && result.exitCode !== 0) {
    const providerError = await readRuntimeErrorFromLog(logFilePath, runtime);
    return {
      text:
        providerError ??
        `Runtime exited with code ${result.exitCode}. Check that the CLI is installed and authenticated.`,
      runtimeSessionId: capturedSessionId,
      failed: true,
    };
  }

  const text = await readAssistantTextFromLog(runtime, logFilePath);
  if (!text.trim()) {
    return {
      text: "The runtime finished without producing a response. Try again, or reset the runtime session.",
      runtimeSessionId: capturedSessionId,
      failed: true,
      failureKind: "empty_output",
    };
  }

  return { text, runtimeSessionId: capturedSessionId };
};

const resolveSessionProviderKey = (session: ChatSession): string =>
  session.runtime === "opencode" ? `opencode:${session.model}` : session.runtime;

const readRuntimeErrorFromLog = async (
  logFilePath: string,
  runtime: string,
): Promise<string | null> => {
  const content = (await readBoundedUtf8File(logFilePath, CHAT_MAX_LOG_BYTES)) ?? "";
  const events = parseRawJsonlContent(content).entries.map(({ event }) => event);
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!event || !isProviderFailureEvent(runtime, event)) continue;
    const message = errorMessageFromValue(event.error ?? event.message ?? event);
    if (message) return `Runtime error: ${message}`;
  }

  const stderr = (await readBoundedUtf8File(`${logFilePath}.stderr`, CHAT_MAX_LOG_BYTES)) ?? "";
  const lastLine = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return lastLine ? `Runtime error: ${lastLine}` : null;
};

const readRuntimeSessionIdFromLog = async (logFilePath: string): Promise<string | null> => {
  const content = (await readBoundedUtf8File(logFilePath, CHAT_MAX_LOG_BYTES)) ?? "";
  return extractRuntimeSessionIdFromRawJsonl(content);
};

const errorMessageFromValue = (value: unknown): string | null => {
  if (typeof value === "string") return errorMessageFromText(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "reason", "detail", "result"]) {
    const message = errorMessageFromValue(record[key]);
    if (message) return message;
  }
  return null;
};

const errorMessageFromText = (value: string): string | null => {
  const text = value.trim();
  if (!text) return null;
  const jsonStart = text.indexOf("{");
  const jsonText = jsonStart >= 0 ? text.slice(jsonStart) : text;
  try {
    return errorMessageFromValue(JSON.parse(jsonText)) ?? text;
  } catch {
    return text;
  }
};

/**
 * Prefer the deliverable answer only — not intermediate status narration.
 * Grok emits status lines and the final reply as separate text runs split by
 * thought/tool events; keep the last run. Other providers use final-message
 * extraction (last complete assistant message).
 */
export const readAssistantTextFromLog = async (
  runtime: string,
  logFilePath: string,
  /** Test seam; production uses CHAT_MAX_LOG_BYTES. */
  maxBytes: number = CHAT_MAX_LOG_BYTES,
): Promise<string> => {
  const content = (await readBoundedUtf8File(logFilePath, maxBytes)) ?? "";
  if (!content.trim()) return "";

  if (isGrokRuntime(runtime)) {
    const lastRun = extractLastGrokTextRunFromRawJsonl(content, {
      requireCompleteLine: false,
    }).text.trim();
    if (lastRun) return lastRun;
    return extractAssistantSignalTextFromRawJsonl(content, {
      requireCompleteLine: false,
    }).text.trim();
  }

  const finalText = extractFinalAssistantTextFromRawJsonl(content, {
    requireCompleteLine: false,
  }).text.trim();
  if (finalText) return finalText;

  return extractAssistantSignalTextFromRawJsonl(content, {
    requireCompleteLine: false,
  }).text.trim();
};

export const isGrokRuntime = (runtime: string): boolean =>
  runtime === "grok-build" || runtime === "grok";

export const createSessionRunLogPath = async (sessionId: string): Promise<string> => {
  const dir = join(aopPaths.logs(), "chat-sessions", sessionId);
  await mkdir(dir, { recursive: true });
  return join(dir, `${Date.now()}-${crypto.randomUUID()}.jsonl`);
};
