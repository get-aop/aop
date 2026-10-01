import { existsSync, readFileSync, statSync } from "node:fs";
import { buildClaudeCodeSpawnEnv, resolveExecHost } from "@aop/infra";
import { extractRuntimeSessionIdFromRawJsonl } from "../logs";
import { assertNativePlanModeSupported } from "../plan-mode";
import { resolveRuntimeAlias } from "../runtime-alias";
import type { LLMProvider, RunOptions, RunResult } from "../types";
import { prepareStdinPrompt, takesStdinPrompt } from "./claude-code-input";

interface StreamContext {
  sessionId?: string;
  onOutput?: (data: Record<string, unknown>, rawLine?: string) => void;
  onActivity?: () => void;
}

export interface Watchdog {
  stop: () => void;
}

export type OutputTimeoutKind = "startup" | "inactivity";

export const createWatchdog = (
  timeoutMs: number,
  getLastActivity: () => number,
  onTimeout: () => void,
  checkIntervalMs = 5000,
): Watchdog => {
  const intervalId = setInterval(() => {
    const elapsed = Date.now() - getLastActivity();
    if (elapsed > timeoutMs) {
      clearInterval(intervalId);
      onTimeout();
    }
  }, checkIntervalMs);

  return { stop: () => clearInterval(intervalId) };
};

export const getFileMtime = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Number.NaN;
  }
};

export const fileHasNonEmptyOutput = (path: string): boolean => {
  try {
    return readFileSync(path, "utf-8").trim().length > 0;
  } catch {
    return false;
  }
};

export const createFileActivityTracker = (
  path: string,
  options: {
    getNow?: () => number;
    readMtime?: (path: string) => number;
  } = {},
): (() => number) => {
  const getNow = options.getNow ?? Date.now;
  const readMtime = options.readMtime ?? getFileMtime;
  let lastActivity = getNow();

  return () => {
    const mtime = readMtime(path);
    if (!Number.isNaN(mtime)) {
      lastActivity = mtime;
    }
    return lastActivity;
  };
};

/**
 * Dual-phase log watchdog: optional first-output (startup) deadline, then inactivity.
 * Startup stops permanently once non-empty primary log bytes appear.
 */
export const createLogOutputTimeoutWatchdog = (input: {
  logFilePath: string;
  startupTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  onTimeout: (kind: OutputTimeoutKind) => void;
  checkIntervalMs?: number;
  getNow?: () => number;
  hasNonEmptyOutput?: (path: string) => boolean;
  getLastActivity?: () => number;
}): Watchdog => {
  const getNow = input.getNow ?? Date.now;
  const hasNonEmptyOutput = input.hasNonEmptyOutput ?? fileHasNonEmptyOutput;
  const checkIntervalMs = input.checkIntervalMs ?? 5000;
  const startedAt = getNow();
  const getLastActivity =
    input.getLastActivity ?? createFileActivityTracker(input.logFilePath, { getNow });

  let phase: "startup" | "inactivity" | "done" =
    input.startupTimeoutMs && input.startupTimeoutMs > 0 ? "startup" : "inactivity";
  let fired = false;

  const fire = (kind: OutputTimeoutKind): void => {
    if (fired || phase === "done") return;
    fired = true;
    phase = "done";
    clearInterval(intervalId);
    input.onTimeout(kind);
  };

  const tick = (): void => {
    if (fired || phase === "done") return;
    const now = getNow();
    if (phase === "startup") {
      phase = advanceStartupPhase({
        hasOutput: hasNonEmptyOutput(input.logFilePath),
        timedOut: Boolean(input.startupTimeoutMs && now - startedAt > input.startupTimeoutMs),
        fireStartup: () => fire("startup"),
      });
      return;
    }
    if (input.inactivityTimeoutMs && now - getLastActivity() > input.inactivityTimeoutMs) {
      fire("inactivity");
    }
  };

  const intervalId = setInterval(tick, checkIntervalMs);

  return {
    stop: () => {
      phase = "done";
      clearInterval(intervalId);
    },
  };
};

const advanceStartupPhase = (input: {
  hasOutput: boolean;
  timedOut: boolean;
  fireStartup: () => void;
}): "startup" | "inactivity" | "done" => {
  if (input.hasOutput) return "inactivity";
  if (input.timedOut) {
    input.fireStartup();
    return "done";
  }
  return "startup";
};

export class ClaudeCodeProvider implements LLMProvider {
  readonly name = "claude-code";

  /** `searchPath` is the PATH of the spawn env, where the command is looked up (see runtime-alias). */
  buildCommand(options: RunOptions, searchPath?: string): string[] {
    assertNativePlanModeSupported(this.name, options.mode);
    const { isolationArgs, mcpConfig } = buildClaudeIsolation(options);

    const stdinPrompt = takesStdinPrompt(options);
    const cmd = [
      resolveRuntimeAlias(options.runtimeAlias, "claude", searchPath),
      ...isolationArgs,
      ...(stdinPrompt ? ["--input-format", "stream-json"] : []),
      "--output-format",
      "stream-json",
      "--verbose",
    ];
    // Partial messages only work in print mode (`claude --help`), so it is asked for explicitly.
    if (options.partialMessages) cmd.push("-p", "--include-partial-messages");

    appendClaudePermissionFlags(cmd, options);

    if (options.resumeSessionId) {
      cmd.push("--resume", options.resumeSessionId);
    }

    const settings = buildClaudeCodeSettings(options);
    if (settings) {
      cmd.push("--settings", JSON.stringify(settings));
    }

    // Absent means "use Claude Code's own default": no flag, so the CLI decides.
    if (options.model) {
      cmd.push("--model", options.model);
    }

    if (options.reasoningEffort) {
      cmd.push("--effort", normalizeClaudeCodeEffort(options.reasoningEffort));
    }

    appendClaudeSystemPromptFlags(cmd, options);
    if (!stdinPrompt) cmd.push(options.prompt);
    appendClaudeVariadicFlags(cmd, options, mcpConfig);

    return cmd;
  }

  parseStreamLine(line: string): Record<string, unknown> | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  extractSessionId(data: Record<string, unknown>): string | undefined {
    const sessionId = data.session_id;
    return typeof sessionId === "string" ? sessionId : undefined;
  }

  async run(options: RunOptions): Promise<RunResult> {
    if (options.logFilePath) {
      return this.runWithFileOutput(options, options.logFilePath);
    }
    return this.runWithPipeOutput(options);
  }

  private async runWithFileOutput(options: RunOptions, logFilePath: string): Promise<RunResult> {
    const spawnEnv = buildClaudeCodeSpawnEnv(options.env);
    const stdinPrompt = prepareStdinPrompt(options);

    const proc = spawnClaude(stdinPrompt, () =>
      resolveExecHost().spawn({
        cmd: this.buildCommand(options, spawnEnv.PATH),
        stdout: { file: logFilePath },
        stderr: "ignore",
        stdin: stdinPrompt ? { file: stdinPrompt.path } : "ignore",
        cwd: options.cwd,
        detached: true,
        unref: true,
        env: spawnEnv,
      }),
    );

    const pid = proc.pid;
    await options.onSpawn?.(pid);

    let timedOut = false;
    let startupTimedOut = false;
    let watchdog: Watchdog | undefined;

    if (options.startupTimeoutMs || options.inactivityTimeoutMs) {
      watchdog = createLogOutputTimeoutWatchdog({
        logFilePath,
        startupTimeoutMs: options.startupTimeoutMs,
        inactivityTimeoutMs: options.inactivityTimeoutMs,
        onTimeout: (kind) => {
          if (kind === "startup") startupTimedOut = true;
          else timedOut = true;
          proc.kill();
        },
      });
    }

    const exitCode = await proc.exited;
    watchdog?.stop();
    stdinPrompt?.remove();

    const logContent = existsSync(logFilePath) ? readFileSync(logFilePath, "utf-8") : "";
    const sessionId = extractRuntimeSessionIdFromRawJsonl(logContent);
    if (sessionId) {
      await options.onSession?.(sessionId);
    }

    return {
      exitCode,
      pid,
      sessionId: sessionId ?? undefined,
      timedOut,
      ...(startupTimedOut ? { startupTimedOut: true } : {}),
    };
  }

  private async runWithPipeOutput(options: RunOptions): Promise<RunResult> {
    const spawnEnv = buildClaudeCodeSpawnEnv(options.env);
    const stdinPrompt = prepareStdinPrompt(options);

    const proc = spawnClaude(stdinPrompt, () =>
      resolveExecHost().spawn({
        cmd: this.buildCommand(options, spawnEnv.PATH),
        stdout: "pipe",
        stderr: "inherit",
        stdin: stdinPrompt ? { file: stdinPrompt.path } : "inherit",
        cwd: options.cwd,
        env: spawnEnv,
      }),
    );

    const pid = proc.pid;
    options.onSpawn?.(pid);

    let lastActivity = Date.now();
    let timedOut = false;
    let watchdog: Watchdog | undefined;

    if (options.inactivityTimeoutMs) {
      watchdog = createWatchdog(
        options.inactivityTimeoutMs,
        () => lastActivity,
        () => {
          timedOut = true;
          proc.kill();
        },
      );
    }

    const ctx: StreamContext = {
      onOutput: options.onOutput,
      onActivity: () => {
        lastActivity = Date.now();
        options.onActivity?.();
      },
    };

    const stdout = proc.stdout;
    if (!(stdout instanceof ReadableStream)) {
      throw new Error("claude-code: expected a piped stdout stream");
    }
    await this.processStream(stdout, ctx);
    watchdog?.stop();
    stdinPrompt?.remove();

    return { exitCode: await proc.exited, pid, sessionId: ctx.sessionId, timedOut };
  }

  private async processStream(
    stdout: ReadableStream<Uint8Array>,
    ctx: StreamContext,
  ): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      ctx.onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      processLines(lines, ctx, this.parseStreamLine);
    }

    if (buffer.trim()) {
      processLines([buffer], ctx, this.parseStreamLine);
    }
  }
}

// The child holds its stdin open from the moment it is spawned, so the prompt file can go at
// once; a spawn that throws leaves no file behind either.
const spawnClaude = (
  stdinPrompt: { remove: () => void } | null,
  spawn: () => Bun.Subprocess,
): Bun.Subprocess => {
  try {
    return spawn();
  } finally {
    stdinPrompt?.remove();
  }
};

const appendClaudePermissionFlags = (cmd: string[], options: RunOptions): void => {
  if (options.mode === "plan") {
    cmd.push("--permission-mode", "plan");
    return;
  }

  const accessMode = options.accessMode ?? "full-access";
  if (accessMode === "approval-required") return;
  if (accessMode === "auto-accept-edits") {
    cmd.push("--permission-mode", "acceptEdits");
    return;
  }
  if (accessMode === "auto") {
    cmd.push("--permission-mode", "auto");
    return;
  }
  cmd.push("--dangerously-skip-permissions");
};

// Variadic flags swallow every following argument up to the next flag, so they all go after the
// positional prompt, whatever else the run sets: a run on Claude Code's default model and effort
// has no flag of its own before the prompt to end one. `--tools` takes one comma-joined value,
// and "" means no built-in tools.
const appendClaudeVariadicFlags = (
  cmd: string[],
  options: RunOptions,
  mcpConfig: Record<string, unknown> | null,
): void => {
  if (mcpConfig) {
    cmd.push("--mcp-config", JSON.stringify(mcpConfig));
  }
  const disallowedTools = normalizeToolList(options.disallowedTools);
  if (disallowedTools.length > 0) {
    cmd.push("--disallowedTools", ...disallowedTools);
  }
  const allowedDirectories = dedupeAllowedDirectories(options.allowedDirectories ?? []);
  if (allowedDirectories.length > 0) {
    cmd.push("--add-dir", ...allowedDirectories);
  }
  const allowedTools = normalizeToolList(options.allowedTools);
  if (allowedTools.length > 0) {
    cmd.push("--allowedTools", ...allowedTools);
  }
  if (options.builtInTools) {
    cmd.push("--tools", normalizeToolList(options.builtInTools).join(","));
  }
};

// By default Claude Code records the system prompt of a conversation's first request, appended
// text included, and sends that record on every later request and resume, ignoring different
// text passed on a later launch (CLI reference: "System prompt flags in resumed conversations").
// `--system-prompt-snapshot off` (Claude Code 2.1.257 or later) renders the prompt afresh each
// request, so an edited instruction reaches a resumed turn.
const appendClaudeSystemPromptFlags = (cmd: string[], options: RunOptions): void => {
  const text = options.appendSystemPrompt?.trim();
  if (!text) return;
  cmd.push("--append-system-prompt", text, "--system-prompt-snapshot", "off");
};

const normalizeClaudeCodeEffort = (effort: string): string =>
  effort === "extra-high" ? "xhigh" : effort;

const buildClaudeCodeSettings = (options: RunOptions): Record<string, unknown> | null => {
  const settings: Record<string, unknown> = {};
  if (options.fastMode) {
    settings.fastMode = true;
  }
  if (options.ultracode) {
    settings.ultracode = true;
  }
  return Object.keys(settings).length > 0 ? settings : null;
};

const buildClaudeMcpConfig = (options: RunOptions): Record<string, unknown> | null => {
  const servers: Record<string, unknown> = {};
  const normalized = options.mcpServerUrl?.trim();
  // Both isolation modes get the aop server: hermetic adds --strict-mcp-config, so there it is
  // the only server the run can reach. `alwaysLoad` (a per-server option of Claude Code 2.1.x MCP
  // configs) keeps every aop tool in the prompt from the first request. Without it, tool search
  // defers MCP tools behind a ToolSearch call, and a thread that must ask the person something
  // could spend a turn looking for `aop_ask_user`. It covers this one server only: the person's
  // own servers keep the CLI's default loading.
  if (normalized) {
    servers.aop = { type: "http", url: normalized, alwaysLoad: true };
  }
  return Object.keys(servers).length > 0 ? { mcpServers: servers } : null;
};

const buildClaudeIsolation = (
  options: RunOptions,
): { isolationArgs: string[]; mcpConfig: Record<string, unknown> | null } => {
  const isolation = options.isolation ?? "hermetic";
  return {
    isolationArgs: claudeIsolationArgs(isolation),
    mcpConfig: buildClaudeMcpConfig(options),
  };
};

const claudeIsolationArgs = (isolation: NonNullable<RunOptions["isolation"]>): string[] =>
  isolation === "hermetic" ? ["--setting-sources", "project", "--strict-mcp-config"] : [];

const normalizeToolList = (tools: string[] | undefined): string[] => [
  ...new Set((tools ?? []).map((tool) => tool.trim()).filter(Boolean)),
];

const dedupeAllowedDirectories = (directories: string[]): string[] => [
  ...new Set(directories.filter((directory) => directory.trim().length > 0)),
];

const processData = (data: Record<string, unknown>, rawLine: string, ctx: StreamContext): void => {
  const sessionId = data.session_id;
  if (typeof sessionId === "string") {
    ctx.sessionId = sessionId;
  }
  ctx.onOutput?.(data, rawLine);
};

const processLines = (
  lines: string[],
  ctx: StreamContext,
  parseStreamLine: (line: string) => Record<string, unknown> | null,
): void => {
  for (const line of lines) {
    const data = parseStreamLine(line);
    if (data) processData(data, line, ctx);
  }
};
