import { createHash } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { aopPaths, getLogger } from "@aop/infra";
import {
  createProvider,
  extractAssistantSignalTextFromRawJsonl,
  extractFinalAssistantTextFromRawJsonl,
  extractRuntimeSessionIdFromRawJsonl,
  type LLMProvider,
  parseRawJsonlContent,
  type RunOptions,
} from "@aop/llm-provider";
import type { ChatRuntimeSessionState, ChatSession } from "../db/schema.ts";
import { runAndReap } from "../process/reaper.ts";
import { isProviderFailureEvent } from "./provider-event-classifier.ts";
import { buildRunOptions } from "./run-options.ts";
import {
  createRuntimeSessionLineInspector,
  startRuntimeSessionTail,
} from "./runtime-session-tail.ts";
import { buildChatRuntimeTimeoutFacts } from "./runtime-timeout-policy.ts";
import {
  type ActiveRunHandle,
  beginSessionRunExecution,
  type InterruptReason,
  releaseSessionRunExecution,
  type SessionRunRegistration,
} from "./session-run-lifecycle.ts";
import { type StreamProgressListener, startLogProgressTail } from "./stream-progress.ts";

export {
  type ActiveRunPhase,
  activeSessionRunIds,
  interruptSessionRun,
  isSessionRunActive,
  isSessionRunInterrupted,
  ownsSessionRunRegistration,
  registerPendingSessionRun,
  releaseSessionRunRegistration,
  type SessionRunRegistration,
  sessionRunPhase,
} from "./session-run-lifecycle.ts";

export type CreateProviderFn = (key: string) => LLMProvider;

/** Chat live runs share durable recovery timeouts for consistent UX. */
export const CHAT_STARTUP_TIMEOUT_MS = 30_000;
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
  /** Extra dirs the provider may read (e.g. chat image attachments). */
  allowedDirectories?: string[];
  /** Durable path allocated before launch so a reloaded server can resume the run. */
  logFilePath?: string;
  createProviderFn?: CreateProviderFn;
  onProgress?: StreamProgressListener;
  onRuntimeSession?: (sessionId: string) => Promise<void> | void;
  /** Receives the spawned CLI's pid (best effort: a failure does not stop the run). */
  onSpawn?: (pid: number) => Promise<void> | void;
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
  const artifactTracker = await startMarkdownArtifactTracker(repoPath);
  try {
    if (owner.interrupted) return interruptedRunResult(handle, session.runtime_session_id);

    const result = await executeProviderRun(
      session,
      repoPath,
      prompt,
      input.allowedDirectories,
      input.logFilePath,
      input.createProviderFn,
      input.onProgress,
      input.onRuntimeSession,
      input.onSpawn,
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

const startMarkdownArtifactTracker = async (repoPath: string): Promise<MarkdownArtifactTracker> => {
  const paths = new Set<string>();
  const baseline = await captureMarkdownWorkspaceState(repoPath);
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
      const current = await captureMarkdownWorkspaceState(repoPath);
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

const captureMarkdownWorkspaceState = async (repoPath: string): Promise<MarkdownWorkspaceState> => {
  const head = await gitText(repoPath, ["rev-parse", "HEAD"]);
  const status = await gitText(repoPath, [
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
  const fingerprints = (
    await Promise.all(
      paths.map(async (path) => {
        const fingerprint = await fileFingerprint(resolve(repoPath, path));
        return fingerprint ? ([[path, fingerprint]] as const) : [];
      }),
    )
  ).flat();
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

const fileFingerprint = async (path: string): Promise<string | null> => {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
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
  allowedDirectories: string[] | undefined,
  durableLogFilePath: string | undefined,
  createProviderFn: CreateProviderFn | undefined,
  onProgress: StreamProgressListener | undefined,
  onRuntimeSession: ((sessionId: string) => Promise<void> | void) | undefined,
  onSpawn: ((pid: number) => Promise<void> | void) | undefined,
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
        onSession: captureRuntimeSession,
      });
      stopTail = startLogProgressTail({
        logFilePath,
        onLine: async (line) => {
          await inspectSessionLine(line);
        },
        onProgress,
      });
    } else {
      stopSessionTail = startRuntimeSessionTail({
        logFilePath,
        onSession: captureRuntimeSession,
      });
    }

    return await raceProviderAgainstInterrupt({
      session,
      repoPath,
      prompt,
      allowedDirectories,
      logFilePath,
      provider,
      handle,
      captureRuntimeSession,
      onSpawn,
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
  const provider = factory(input.session.runtime);
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
  allowedDirectories: string[] | undefined;
  logFilePath: string;
  provider: LLMProvider;
  handle: ActiveRunHandle;
  captureRuntimeSession: (id: string) => Promise<void>;
  onSpawn: ((pid: number) => Promise<void> | void) | undefined;
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
    input.captureRuntimeSession,
    input.logFilePath,
    input.allowedDirectories,
    async (pid) => {
      input.handle.pid = pid;
      input.handle.resolvePid(pid);
      input.handle.phase = input.handle.owner.interrupted ? "cancelling" : "running";
      await reportSpawnedPid(input.onSpawn, pid, input.session.id);
    },
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
  const result = await runAndReap(input.provider, input.options);
  return finalizeCompletedProviderRun({ ...input, result, providerStartedAt });
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

const reportSpawnedPid = async (
  onSpawn: ((pid: number) => Promise<void> | void) | undefined,
  pid: number,
  sessionId: string,
): Promise<void> => {
  try {
    await onSpawn?.(pid);
  } catch (error) {
    runtimeLogger.warn("Could not record chat runtime pid {pid} for {sessionId}: {error}", {
      pid,
      sessionId,
      error: String(error),
    });
  }
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

  const target = await createProviderProcessTarget(pid);
  await signalProvider(target, handle.interruptSignal);
  const exitedAfterInterrupt = await waitUntilProviderExited(target, providerSettled, 1_500);
  if (exitedAfterInterrupt) return;
  if (handle.interruptSignal !== "SIGTERM") {
    await signalProvider(target, "SIGTERM");
    const exitedAfterTerm = await waitUntilProviderExited(target, providerSettled, 1_000);
    if (exitedAfterTerm) return;
  }
  await signalProvider(target, "SIGKILL");
  await waitUntilProviderExited(target, providerSettled);
};

interface ProviderProcessTarget {
  rootPid: number;
  descendantPids: Set<number>;
}

const createProviderProcessTarget = async (rootPid: number): Promise<ProviderProcessTarget> => {
  // Scan while the root is alive: detached children reparent to init as soon
  // as the root exits and would be unreachable afterwards.
  const descendantPids = new Set(await descendantProcessIds(rootPid));
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
  while (await providerTargetIsAlive(target, providerHasSettled)) {
    if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) return false;
    await Bun.sleep(50);
  }
  return true;
};

const providerTargetIsAlive = async (
  target: ProviderProcessTarget,
  providerHasSettled: boolean,
): Promise<boolean> => {
  if (!providerHasSettled && isProviderProcessAlive(target.rootPid)) {
    for (const pid of await descendantProcessIds(target.rootPid)) target.descendantPids.add(pid);
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

const signalProvider = async (
  target: ProviderProcessTarget,
  signal: NodeJS.Signals,
): Promise<void> => {
  // Signal the root first so the stop path is not delayed by the descendant
  // scan; children are reaped right after.
  try {
    process.kill(-target.rootPid, signal);
  } catch {
    try {
      process.kill(target.rootPid, signal);
    } catch {
      // The process exited between observation and signaling.
    }
  }
  for (const descendant of await descendantProcessIds(target.rootPid)) {
    target.descendantPids.add(descendant);
  }
  for (const descendant of target.descendantPids) {
    try {
      process.kill(descendant, signal);
    } catch {
      // The child exited between process discovery and signaling.
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

// Shared, short-lived process-table snapshot so concurrent trackers poll once
// instead of spawning `ps` per check; async so it never blocks the event loop.
const PROCESS_SNAPSHOT_TTL_MS = 100;
let processSnapshot: { at: number; childrenByParent: Map<number, number[]> } | null = null;

const getProcessTreeSnapshot = async (): Promise<Map<number, number[]>> => {
  const now = Date.now();
  if (processSnapshot && now - processSnapshot.at < PROCESS_SNAPSHOT_TTL_MS) {
    return processSnapshot.childrenByParent;
  }

  const result = await Bun.spawn(["ps", "-axo", "pid=,ppid="] as const, {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([new Response(result.stdout).text(), result.exited]);
  const childrenByParent = exitCode === 0 ? parseProcessTable(stdout) : new Map<number, number[]>();
  processSnapshot = { at: now, childrenByParent };
  return childrenByParent;
};

const parseProcessTable = (stdout: string): Map<number, number[]> => {
  const childrenByParent = new Map<number, number[]>();
  for (const line of stdout.split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/);
    const pid = Number.parseInt(pidText ?? "", 10);
    const parent = Number.parseInt(parentText ?? "", 10);
    if (!Number.isFinite(pid) || !Number.isFinite(parent)) continue;
    const siblings = childrenByParent.get(parent) ?? [];
    siblings.push(pid);
    childrenByParent.set(parent, siblings);
  }
  return childrenByParent;
};

const descendantProcessIds = async (rootPid: number): Promise<number[]> => {
  const childrenByParent = await getProcessTreeSnapshot();
  const descendants: number[] = [];
  const visit = (parent: number) => {
    for (const child of childrenByParent.get(parent) ?? []) {
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

const interpretRunResult = async (
  runtime: string,
  result: {
    exitCode: number;
    sessionId?: string;
    timedOut?: boolean;
    startupTimedOut?: boolean;
  },
  logFilePath: string,
  capturedSessionId: string | null,
): Promise<RuntimeRunResult> => {
  if (result.startupTimedOut) {
    return {
      text: "The runtime produced no output before the startup deadline. Try again, or reset the runtime session.",
      runtimeSessionId: capturedSessionId,
      startupTimedOut: true,
      failed: true,
      failureKind: "startup_timeout",
    };
  }

  if (result.timedOut) {
    return {
      text: "The runtime stopped responding (inactivity timeout). Try again, or switch model/effort.",
      runtimeSessionId: capturedSessionId,
      timedOut: true,
      failed: true,
    };
  }

  if (result.exitCode !== 0) {
    const providerError = await readRuntimeErrorFromLog(logFilePath, runtime);
    return {
      text:
        providerError ??
        `Runtime exited with code ${result.exitCode}. Check that the CLI is installed and authenticated.`,
      runtimeSessionId: capturedSessionId,
      failed: true,
    };
  }

  const text = await readAssistantTextFromLog(logFilePath);
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
 * Prefer the deliverable answer only, not intermediate status narration: final-message
 * extraction keeps the last complete assistant message.
 */
export const readAssistantTextFromLog = async (
  logFilePath: string,
  /** Test seam; production uses CHAT_MAX_LOG_BYTES. */
  maxBytes: number = CHAT_MAX_LOG_BYTES,
): Promise<string> => {
  const content = (await readBoundedUtf8File(logFilePath, maxBytes)) ?? "";
  if (!content.trim()) return "";

  const finalText = extractFinalAssistantTextFromRawJsonl(content, {
    requireCompleteLine: false,
  }).text.trim();
  if (finalText) return finalText;

  return extractAssistantSignalTextFromRawJsonl(content, {
    requireCompleteLine: false,
  }).text.trim();
};

export const createSessionRunLogPath = async (sessionId: string): Promise<string> => {
  const dir = join(aopPaths.logs(), "chat-sessions", sessionId);
  await mkdir(dir, { recursive: true });
  return join(dir, `${Date.now()}-${crypto.randomUUID()}.jsonl`);
};
