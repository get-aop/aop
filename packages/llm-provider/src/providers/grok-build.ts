import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildSpawnEnv, resolveExecHost } from "@aop/infra";
import { extractRuntimeSessionIdFromRawJsonl } from "../logs";
import { assertNativePlanModeSupported } from "../plan-mode";
import { resolveRuntimeAlias } from "../runtime-alias";
import { sanitizeGrokSessionId, sanitizeSessionId } from "../session-id";
import type { LLMProvider, RunOptions, RunResult, RunToolProgress } from "../types";
import {
  createFileActivityTracker,
  createLogOutputTimeoutWatchdog,
  fileHasNonEmptyOutput,
  type Watchdog,
} from "./claude-code";

const DEFAULT_GROK_EXECUTABLE = "grok";
const GROK_MODEL_ENV = "AOP_GROK_MODEL";
const GROK_EFFORT_ENV = "AOP_GROK_EFFORT";
const GROK_COMPLETION_POLL_MS = 250;
const GROK_EXIT_GRACE_MS = 1_000;
const LEGACY_GROK_MODELS: Record<string, string> = {
  "composer-2.5": "grok-composer-2.5-fast",
};

export class GrokBuildProvider implements LLMProvider {
  readonly name = "grok-build";
  readonly interruptSignal = "SIGINT";

  buildCommand(options: RunOptions & { promptFile?: string }): string[] {
    assertNativePlanModeSupported(this.name, options.mode);
    const prompt = options.mode === "plan" ? `/plan ${options.prompt}` : options.prompt;
    const cmd = [
      resolveRuntimeAlias(options.runtimeAlias, DEFAULT_GROK_EXECUTABLE),
      "--no-auto-update",
      // Multi-line / leading-dash prompts (for example, skill YAML frontmatter) break clap when
      // passed as `-p <PROMPT>`. Prefer --prompt-file whenever the caller prepared one.
      ...(options.promptFile ? ["--prompt-file", options.promptFile] : ["-p", prompt]),
      "--output-format",
      "streaming-json",
    ];
    appendGrokPermissionFlags(cmd, options);
    appendGrokRunArguments(cmd, options);
    return cmd;
  }

  async run(options: RunOptions): Promise<RunResult> {
    const logPath = options.logFilePath;
    const prompt = options.mode === "plan" ? `/plan ${options.prompt}` : options.prompt;
    const promptFile = needsPromptFile(prompt) ? writePromptFile(prompt, logPath) : undefined;
    let lastNativeActivity = 0;
    const completionTracker = createGrokTurnCompletionTracker(options, () => {
      lastNativeActivity = Date.now();
      options.onActivity?.();
    });
    const proc = (options.execHost ?? resolveExecHost()).spawn({
      cmd: this.buildCommand({ ...options, promptFile }),
      stdout: logPath ? { file: logPath } : "ignore",
      stderr: logPath ? { file: `${logPath}.stderr` } : "ignore",
      stdin: "ignore",
      cwd: options.cwd,
      detached: true,
      unref: true,
      env: buildSpawnEnv(buildGrokSpawnEnv(options)),
    });

    const pid = proc.pid;
    await options.onSpawn?.(pid);

    const timeoutState = { timedOut: false, startupTimedOut: false };
    const watchdog = startRunWatchdog(
      logPath,
      options,
      () => {
        proc.kill();
      },
      timeoutState,
      () => lastNativeActivity,
    );

    const exit = await waitForGrokExit(proc, completionTracker);
    watchdog?.stop();
    await completionTracker?.stop();

    return finalizeGrokRun({
      options,
      logPath,
      pid,
      exit,
      timeoutState,
    });
  }
}

/** Env var read by ~/.grok/config.toml: mcp_servers.aop.url = "${AOP_MCP_SERVER_URL}" */
export const AOP_MCP_SERVER_URL_ENV = "AOP_MCP_SERVER_URL";

const appendGrokRunArguments = (
  command: string[],
  options: RunOptions & { promptFile?: string },
): void => {
  if (options.cwd) command.push("--cwd", options.cwd);
  const rawModel = options.model ?? options.env?.[GROK_MODEL_ENV];
  const model = rawModel ? (LEGACY_GROK_MODELS[rawModel] ?? rawModel) : undefined;
  if (model) command.push("-m", model);
  const effort = options.reasoningEffort ?? options.env?.[GROK_EFFORT_ENV];
  if (effort) command.push("--effort", effort);
  command.push(...resolveGrokSessionArguments(options));
};

const appendGrokPermissionFlags = (command: string[], options: RunOptions): void => {
  if (options.mode === "plan") {
    command.push("--permission-mode", "plan");
    return;
  }

  const accessMode = options.accessMode ?? "full-access";
  if (accessMode === "approval-required" || accessMode === "auto") {
    command.push("--permission-mode", "default");
    return;
  }
  if (accessMode === "auto-accept-edits") {
    command.push("--permission-mode", "acceptEdits");
    return;
  }
  command.push("--permission-mode", "bypassPermissions");
};

/** Merge caller env with the authenticated AOP MCP URL for Grok's config expansion. */
export const buildGrokSpawnEnv = (
  options: Pick<RunOptions, "env" | "mcpServerUrl">,
): Record<string, string> => {
  const env = { ...(options.env ?? {}) };
  const mcpServerUrl = options.mcpServerUrl?.trim();
  if (mcpServerUrl) env[AOP_MCP_SERVER_URL_ENV] = mcpServerUrl;
  return env;
};

interface GrokTurnCompletionTracker {
  completed: Promise<void>;
  stop: () => Promise<void>;
}

interface GrokExitResult {
  exitCode: number;
  completedFromSessionEvent: boolean;
}

const finalizeGrokRun = async (input: {
  options: RunOptions;
  logPath?: string;
  pid?: number;
  exit: GrokExitResult;
  timeoutState: RunTimeoutState;
}): Promise<RunResult> => {
  const loggedSessionId = input.logPath ? readSessionIdFromLog(input.logPath) : undefined;
  const knownSessionId = input.options.resumeSessionId ?? input.options.newSessionId;
  const sessionId =
    sanitizeSessionId(loggedSessionId) ??
    (input.exit.completedFromSessionEvent ? sanitizeSessionId(knownSessionId) : undefined);
  if (sessionId && input.options.newSessionId && sessionId !== input.options.newSessionId) {
    throw new Error(
      `Grok returned session id ${sessionId}, expected preassigned id ${input.options.newSessionId}`,
    );
  }
  if (sessionId) await input.options.onSession?.(sessionId);

  return {
    exitCode: input.exit.exitCode,
    pid: input.pid,
    sessionId,
    completedFromSessionEvent: input.exit.completedFromSessionEvent || undefined,
    timedOut: input.timeoutState.timedOut,
    startupTimedOut: input.timeoutState.startupTimedOut || undefined,
  };
};

const createGrokTurnCompletionTracker = (
  options: Pick<RunOptions, "cwd" | "env" | "newSessionId" | "onToolProgress" | "resumeSessionId">,
  onActivity?: () => void,
): GrokTurnCompletionTracker | undefined => {
  const sessionId = options.resumeSessionId ?? options.newSessionId;
  if (!options.cwd || !sessionId) return undefined;

  return startGrokJournalTail({
    cwd: options.cwd,
    sessionId,
    home: options.env?.HOME,
    onToolProgress: options.onToolProgress,
    onActivity,
  });
};

export interface GrokJournalTail {
  completed: Promise<void>;
  stop: () => Promise<void>;
}

export const startGrokJournalTail = (input: {
  cwd: string;
  sessionId: string;
  home?: string;
  onToolProgress?: (event: RunToolProgress) => void;
  onActivity?: () => void;
  pollIntervalMs?: number;
}): GrokJournalTail => {
  const paths = grokJournalPaths(input.cwd, input.sessionId, input.home);
  const eventsTail = new JsonlFileTail(paths.events, initialFileSize(paths.events));
  const updatesTail = new JsonlFileTail(paths.updates, initialFileSize(paths.updates));
  let resolveCompleted: () => void = () => {};
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve;
  });
  let stopped = false;
  let polling: Promise<void> | null = null;
  const poll = () => {
    if (stopped || polling) return;
    polling = Promise.all([
      eventsTail.poll((line) => {
        if (!hasCompletedTurn(line)) return;
        stopped = true;
        clearInterval(intervalId);
        resolveCompleted();
      }),
      updatesTail.poll((line) =>
        forwardGrokToolProgress(line, input.onToolProgress, input.onActivity),
      ),
    ])
      .then(() => undefined)
      .finally(() => {
        polling = null;
      });
  };
  const intervalId = setInterval(poll, input.pollIntervalMs ?? GROK_COMPLETION_POLL_MS);

  return {
    completed,
    stop: async () => {
      stopped = true;
      clearInterval(intervalId);
      await polling;
      await Promise.all([eventsTail.close(), updatesTail.close()]);
    },
  };
};

const forwardGrokToolProgress = (
  line: string,
  onToolProgress: RunOptions["onToolProgress"],
  onActivity?: () => void,
): void => {
  const progress = parseGrokToolProgressLine(line);
  if (!progress) return;
  onToolProgress?.(progress);
  onActivity?.();
};

const parseGrokToolProgressLine = (line: string): RunToolProgress | null => {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    return grokToolProgressFromUpdate(recordValue(recordValue(event.params)?.update));
  } catch {
    return null;
  }
};

const grokToolProgressFromUpdate = (
  update: Record<string, unknown> | null,
): RunToolProgress | null => {
  const id = stringValue(update?.toolCallId);
  if (!update || !id) return null;
  const sessionUpdate = stringValue(update.sessionUpdate);
  if (sessionUpdate === "tool_call") return grokToolStart(id, update);
  if (sessionUpdate === "tool_call_update") return grokToolUpdate(id, update);
  return null;
};

const grokToolStart = (id: string, update: Record<string, unknown>): RunToolProgress => {
  const rawInput = recordValue(update.rawInput);
  return {
    id,
    phase: "start",
    name: stringValue(update.title) ?? "Tool",
    detail:
      stringValue(rawInput?.description) ??
      stringValue(rawInput?.command) ??
      stringValue(update.title),
  };
};

const grokToolUpdate = (id: string, update: Record<string, unknown>): RunToolProgress => {
  const status = stringValue(update.status)?.toLowerCase();
  const failed = status === "failed" || status === "error" || status === "cancelled";
  const done = failed || status === "completed" || status === "complete" || status === "done";
  return {
    id,
    phase: done ? "done" : "update",
    name: undefined,
    detail: grokToolUpdateText(update),
    ...(done ? { failed } : {}),
  };
};

const grokToolUpdateText = (update: Record<string, unknown>): string | undefined => {
  if (Array.isArray(update.content)) {
    for (const item of [...update.content].reverse()) {
      const content = recordValue(recordValue(item)?.content);
      const text = stringValue(content?.text);
      if (text) return text;
    }
  }
  const rawOutput = recordValue(update.rawOutput);
  return stringValue(rawOutput?.output_for_prompt) ?? stringValue(rawOutput?.output);
};

const recordValue = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const hasCompletedTurn = (line: string): boolean => {
  if (!line.trim()) return false;
  try {
    const event = JSON.parse(line) as { type?: unknown; outcome?: unknown };
    return event.type === "turn_ended" && event.outcome === "completed";
  } catch {
    return false;
  }
};

export const hasUnfinishedGrokTools = async (input: {
  cwd: string;
  sessionId: string;
  home?: string;
}): Promise<boolean> => {
  const { events } = grokJournalPaths(input.cwd, input.sessionId, input.home);
  let activeTools = 0;
  await scanJsonlPrefixes(events, (prefix) => {
    const type = jsonEventType(prefix);
    if (type === "turn_started" || type === "turn_ended") activeTools = 0;
    else if (type === "tool_started") activeTools += 1;
    else if (type === "tool_completed") activeTools = Math.max(0, activeTools - 1);
  });
  return activeTools > 0;
};

const grokJournalPaths = (cwd: string, sessionId: string, home?: string) => {
  const sessionPath = join(
    home?.trim() || homedir(),
    ".grok",
    "sessions",
    encodeURIComponent(cwd),
    sessionId,
  );
  return {
    events: join(sessionPath, "events.jsonl"),
    updates: join(sessionPath, "updates.jsonl"),
  };
};

const initialFileSize = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

const JSONL_READ_BYTES = 64 * 1024;
const JSONL_PREFIX_BYTES = 1_024;

class JsonlFileTail {
  private handle: FileHandle | null = null;
  private pending: Buffer[] = [];
  private pendingBytes = 0;

  constructor(
    private readonly path: string,
    private offset: number,
  ) {}

  async poll(onLine: (line: string) => void): Promise<void> {
    const handle = await this.getHandle();
    if (!handle) return;
    const size = (await handle.stat()).size;
    if (size < this.offset) {
      this.offset = 0;
      this.pending = [];
      this.pendingBytes = 0;
    }
    while (this.offset < size) {
      const chunk = Buffer.allocUnsafe(Math.min(JSONL_READ_BYTES, size - this.offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.offset);
      if (bytesRead === 0) break;
      this.offset += bytesRead;
      this.consume(chunk.subarray(0, bytesRead), onLine);
    }
  }

  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    await handle?.close();
  }

  private async getHandle(): Promise<FileHandle | null> {
    if (this.handle) return this.handle;
    this.handle = await open(this.path, "r").catch(() => null);
    return this.handle;
  }

  private consume(chunk: Buffer, onLine: (line: string) => void): void {
    let start = 0;
    for (let newline = chunk.indexOf(10, start); newline >= 0; newline = chunk.indexOf(10, start)) {
      this.push(chunk.subarray(start, newline));
      onLine(Buffer.concat(this.pending, this.pendingBytes).toString("utf8"));
      this.pending = [];
      this.pendingBytes = 0;
      start = newline + 1;
    }
    this.push(chunk.subarray(start));
  }

  private push(fragment: Buffer): void {
    if (fragment.length === 0) return;
    this.pending.push(fragment);
    this.pendingBytes += fragment.length;
  }
}

const scanJsonlPrefixes = async (
  path: string,
  onLinePrefix: (prefix: string) => void,
): Promise<void> => {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return;
  let offset = 0;
  let prefix: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  try {
    const size = (await handle.stat()).size;
    while (offset < size) {
      const chunk = Buffer.allocUnsafe(Math.min(JSONL_READ_BYTES, size - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      let start = 0;
      const content = chunk.subarray(0, bytesRead);
      for (
        let newline = content.indexOf(10, start);
        newline >= 0;
        newline = content.indexOf(10, start)
      ) {
        prefix = appendPrefix(prefix, content.subarray(start, newline));
        onLinePrefix(prefix.toString("utf8"));
        prefix = Buffer.alloc(0);
        start = newline + 1;
      }
      prefix = appendPrefix(prefix, content.subarray(start));
    }
    if (prefix.length > 0) onLinePrefix(prefix.toString("utf8"));
  } finally {
    await handle.close();
  }
};

const appendPrefix = (
  prefix: Buffer<ArrayBufferLike>,
  fragment: Buffer<ArrayBufferLike>,
): Buffer<ArrayBufferLike> => {
  const remaining = JSONL_PREFIX_BYTES - prefix.length;
  if (remaining <= 0 || fragment.length === 0) return prefix;
  return Buffer.concat([prefix, fragment.subarray(0, remaining)]);
};

const jsonEventType = (prefix: string): string | undefined =>
  prefix.match(/"type"\s*:\s*"([^"]+)"/)?.[1];

const waitForGrokExit = async (
  proc: ReturnType<ReturnType<typeof resolveExecHost>["spawn"]>,
  completionTracker: GrokTurnCompletionTracker | undefined,
): Promise<GrokExitResult> => {
  if (!completionTracker) {
    return { exitCode: await proc.exited, completedFromSessionEvent: false };
  }

  const processExit = Promise.resolve(proc.exited).then((exitCode) => ({
    kind: "exit" as const,
    exitCode,
  }));
  const completedTurn = completionTracker.completed.then(() => ({
    kind: "completed" as const,
  }));
  const first = await Promise.race([processExit, completedTurn]);
  if (first.kind === "exit") {
    return { exitCode: first.exitCode, completedFromSessionEvent: false };
  }

  const gracefulExit = await Promise.race([
    processExit,
    new Promise<{ kind: "grace-expired" }>((resolve) =>
      setTimeout(() => resolve({ kind: "grace-expired" }), GROK_EXIT_GRACE_MS),
    ),
  ]);
  if (gracefulExit.kind === "exit") {
    return { exitCode: gracefulExit.exitCode, completedFromSessionEvent: true };
  }

  proc.kill();
  return { exitCode: await proc.exited, completedFromSessionEvent: true };
};

const resolveGrokSessionArguments = (options: RunOptions): string[] => {
  if (options.resumeSessionId && options.newSessionId) {
    throw new Error("resumeSessionId and newSessionId are mutually exclusive");
  }
  if (options.resumeSessionId) return ["--resume", options.resumeSessionId];
  if (!options.newSessionId) return [];
  const newSessionId = sanitizeGrokSessionId(options.newSessionId);
  if (!newSessionId) throw new Error("Grok newSessionId must be a valid UUID");
  return ["--session-id", newSessionId];
};

interface RunTimeoutState {
  timedOut: boolean;
  startupTimedOut: boolean;
}

const startRunWatchdog = (
  logPath: string | undefined,
  options: Pick<RunOptions, "startupTimeoutMs" | "inactivityTimeoutMs">,
  onKill: () => void,
  state: RunTimeoutState,
  getLastNativeActivity: () => number,
): Watchdog | undefined => {
  if (!logPath || (!options.startupTimeoutMs && !options.inactivityTimeoutMs)) return undefined;
  const getFileActivity = createFileActivityTracker(logPath);
  return createLogOutputTimeoutWatchdog({
    logFilePath: logPath,
    startupTimeoutMs: options.startupTimeoutMs,
    inactivityTimeoutMs: options.inactivityTimeoutMs,
    onTimeout: (kind) => {
      if (kind === "startup") state.startupTimedOut = true;
      else state.timedOut = true;
      onKill();
    },
    hasNonEmptyOutput: (path) => fileHasNonEmptyOutput(path) || getLastNativeActivity() > 0,
    getLastActivity: () => Math.max(getFileActivity(), getLastNativeActivity()),
  });
};

/** Clap treats argv values that start with `-` as flags unless passed via a dedicated file form. */
const needsPromptFile = (prompt: string): boolean =>
  prompt.startsWith("-") || prompt.includes("\n");

const writePromptFile = (prompt: string, logPath?: string): string => {
  const path = logPath
    ? `${logPath}.prompt`
    : join(tmpdir(), `aop-grok-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(path, prompt, "utf-8");
  return path;
};

const readSessionIdFromLog = (logFilePath: string): string | undefined => {
  if (!existsSync(logFilePath)) {
    return undefined;
  }

  return extractRuntimeSessionIdFromRawJsonl(readFileSync(logFilePath, "utf-8")) ?? undefined;
};
