import type { ExecHost, OutputHandler } from "@aop/infra";
import type { RunUsage } from "./logs/usage";
import type { RunMode } from "./plan-mode";

export type { RunMode } from "./plan-mode";
export {
  assertNativePlanModeSupported,
  supportsNativePlanMode,
  UnsupportedPlanModeError,
} from "./plan-mode";

export type RunIsolation = "hermetic" | "open";
export type RunAccessMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";

export interface RunOptions {
  prompt: string;
  cwd?: string;
  resumeSessionId?: string;
  model?: string;
  reasoningEffort?: string;
  /** Optional executable alias for CLI providers, e.g. cdx instead of codex. */
  runtimeAlias?: string;
  /** When "plan", invoke the provider's native read-only plan mode. Defaults to execute. */
  mode?: RunMode;
  /** Command and file permission policy. Defaults to full access for backward compatibility. */
  accessMode?: RunAccessMode;
  /** Runtime configuration zone. Defaults to hermetic so undeclared callers fail closed. */
  isolation?: RunIsolation;
  onOutput?: OutputHandler;
  /** Called when stream activity occurs, useful for timeout tracking */
  onActivity?: () => void;
  /**
   * Deadline for first non-empty primary log output after spawn.
   * When set, process is killed if the log stays empty until this many ms.
   */
  startupTimeoutMs?: number;
  /** Timeout in milliseconds for inactivity. Process killed if no output for this duration. */
  inactivityTimeoutMs?: number;
  /** Called immediately after the process is spawned with its PID */
  onSpawn?: (pid: number) => void | Promise<void>;
  /** Called when the provider discovers the runtime session id. */
  onSession?: (sessionId: string) => void | Promise<void>;
  /** Environment variables to merge with process.env when spawning */
  env?: Record<string, string>;
  /** Path to a file where stdout should be redirected instead of piped */
  logFilePath?: string;
  /** Extra directories the provider may read, used for internal task artifacts. */
  allowedDirectories?: string[];
  /** Provider tool names to deny for this run. */
  disallowedTools?: string[];
  /**
   * Tool names to pre-approve for this run (Claude `--allowedTools`). A run with no terminal
   * cannot ask for permission, so MCP tools such as `mcp__aop__aop_ask_user` must be listed here.
   */
  allowedTools?: string[];
  /**
   * Restricts the provider's built-in tool set (Claude `--tools`). An empty array disables every
   * built-in tool and leaves MCP tools only; unset keeps the provider's default set.
   */
  builtInTools?: string[];
  /**
   * Text added to the CLI's system prompt on this launch (Claude Code `--append-system-prompt`).
   * Pass it on every launch of a conversation, resumes included: the adapter also stops Claude
   * Code reusing the prompt it recorded on the first launch, which would ignore a change made
   * since. The text goes on the command line, so a caller keeps it well under 128 KiB.
   */
  appendSystemPrompt?: string;
  /** Enable Claude Code fast mode for faster output */
  fastMode?: boolean;
  /** Enable Claude Code Ultracode workflow orchestration for the session */
  ultracode?: boolean;
  /** Enable provider-native browser tools with an isolated Playwright fallback. */
  browserControl?: boolean;
  /** Enable provider-native desktop computer control when the runtime supports it. */
  computerControl?: boolean;
  /**
   * HTTP URL for AOP MCP tools (chat-first orchestration). Providers that
   * support MCP should pass this through their spawn config when set.
   */
  mcpServerUrl?: string;
  /**
   * When set, spawn through this host instead of resolveExecHost().
   * Used for SSH remote execution hosts.
   */
  execHost?: ExecHost;
}

export interface RunResult {
  exitCode: number;
  pid?: number;
  sessionId?: string;
  /** True if the process was killed due to inactivity timeout */
  timedOut?: boolean;
  /** True if the process was killed because no non-empty log output arrived before startupTimeoutMs */
  startupTimedOut?: boolean;
  /** Provider-reported usage when available without parsing raw logs. */
  usage?: RunUsage;
}

export interface LLMProvider {
  readonly name: string;
  /** Signal the runtime handles as a graceful cancellation request. */
  readonly interruptSignal?: NodeJS.Signals;
  run(options: RunOptions): Promise<RunResult>;
}

export type {
  AssistantSignalText,
  InferredRunOutcome,
  LogProvider,
  LogStream,
  NormalizedLogEvent,
  ParsedRawJsonl,
  ParsedRawLogEntry,
  RawProviderEvent,
  RenderedLogLine,
  RunOutcome,
} from "./logs";
