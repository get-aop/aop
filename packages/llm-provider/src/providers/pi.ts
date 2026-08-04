import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildSpawnEnv, resolveExecHost } from "@aop/infra";
import { extractRuntimeSessionIdFromRawJsonl } from "../logs";
import { assertNativePlanModeSupported } from "../plan-mode";
import { resolveRuntimeAlias } from "../runtime-alias";
import { sanitizeSessionId } from "../session-id";
import type { LLMProvider, RunOptions, RunResult } from "../types";
import { createLogOutputTimeoutWatchdog, type Watchdog } from "./claude-code";

const PI_MODEL_ENV = "AOP_PI_MODEL";
const PI_THINKING_ENV = "AOP_PI_THINKING";
const PI_SESSION_DIR = "pi-sessions";
const PI_BASH_TIMEOUT_ENV = "AOP_PI_BASH_TIMEOUT_SECS";
const PI_GUARDRAIL_EXTENSION_ENV = "AOP_PI_GUARDRAIL_EXTENSION";
const PI_ACCESS_MODE_ENV = "AOP_PI_ACCESS_MODE";
const DEFAULT_PI_BASH_TIMEOUT_SECS = 240;
const PI_BASH_TIMEOUT_MARGIN_SECS = 60;
const PI_GUARDRAIL_EXTENSION_SOURCE = `
const configuredTimeout = Number.parseInt(process.env.${PI_BASH_TIMEOUT_ENV} ?? "", 10);
const defaultTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : ${DEFAULT_PI_BASH_TIMEOUT_SECS};
const readOnlyTools = new Set(["read", "grep", "find", "ls"]);
const autoAcceptedTools = new Set([...readOnlyTools, "edit", "write"]);

export default (pi) => {
  pi.on("tool_call", (event) => {
    if (event.toolName === "bash" && event.input && typeof event.input === "object") {
      if (event.input.timeout === undefined) event.input.timeout = defaultTimeout;
    }
    const accessMode = process.env.${PI_ACCESS_MODE_ENV} ?? "full-access";
    if (accessMode === "full-access") return;
    const allowed = accessMode === "auto-accept-edits"
      ? autoAcceptedTools.has(event.toolName)
      : readOnlyTools.has(event.toolName);
    if (allowed) return;
    return {
      block: true,
      reason: accessMode === "auto-accept-edits"
        ? "This action requires approval in Auto-accept edits mode. Ask the user before retrying."
        : "This action requires approval in Supervised mode. Ask the user before retrying.",
    };
  });
};
`.trimStart();

export interface PiRuntimeAdapter {
  launch(options: RunOptions): Promise<RunResult>;
}

export class PiProvider implements LLMProvider {
  readonly name = "pi";

  private readonly commandAdapter = new PiCliRuntimeAdapter();

  constructor(private readonly runtime: PiRuntimeAdapter = new PiCliRuntimeAdapter()) {}

  buildCommand(options: RunOptions): string[] {
    return this.commandAdapter.buildCommand(options);
  }

  async run(options: RunOptions): Promise<RunResult> {
    return this.runtime.launch(options);
  }
}

export class PiCliRuntimeAdapter implements PiRuntimeAdapter {
  buildCommand(options: RunOptions): string[] {
    assertNativePlanModeSupported("pi", options.mode);

    const cmd = [resolveRuntimeAlias(options.runtimeAlias, "pi"), "--mode", "json", "--print"];

    const model = options.model ?? options.env?.[PI_MODEL_ENV];
    if (model) {
      cmd.push("--model", model);
    }

    const thinking = options.reasoningEffort ?? options.env?.[PI_THINKING_ENV];
    if (thinking) {
      cmd.push("--thinking", thinking);
    }

    if (options.resumeSessionId) {
      cmd.push("--session", options.resumeSessionId);
    }

    const guardrailExtension = options.env?.[PI_GUARDRAIL_EXTENSION_ENV];
    if (guardrailExtension) {
      cmd.push("--extension", guardrailExtension);
    }

    cmd.push(options.prompt);
    return cmd;
  }

  async launch(options: RunOptions): Promise<RunResult> {
    const piEnv = buildPiEnv(options.env, options.inactivityTimeoutMs, options.accessMode);
    const spawnEnv = buildSpawnEnv(piEnv);

    const proc = (options.execHost ?? resolveExecHost()).spawn({
      cmd: this.buildCommand({ ...options, env: piEnv }),
      stdout: options.logFilePath ? { file: options.logFilePath } : "ignore",
      stderr: options.logFilePath ? { file: `${options.logFilePath}.stderr` } : "ignore",
      stdin: "ignore",
      cwd: options.cwd,
      detached: true,
      unref: true,
      env: spawnEnv,
    });

    const pid = proc.pid;
    await options.onSpawn?.(pid);

    let timedOut = false;
    let startupTimedOut = false;
    let watchdog: Watchdog | undefined;

    const logPath = options.logFilePath;
    if (logPath && (options.startupTimeoutMs || options.inactivityTimeoutMs)) {
      watchdog = createLogOutputTimeoutWatchdog({
        logFilePath: logPath,
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

    return {
      exitCode,
      pid,
      sessionId: sanitizeSessionId(logPath ? readSessionIdFromLog(logPath) : undefined),
      timedOut,
      ...(startupTimedOut ? { startupTimedOut: true } : {}),
    };
  }
}

const buildPiEnv = (
  extraEnv?: Record<string, string>,
  inactivityTimeoutMs?: number,
  accessMode?: RunOptions["accessMode"],
): Record<string, string> => {
  const baseEnv = {
    ...(extraEnv ?? {}),
  };
  const aopHome = baseEnv.AOP_HOME ?? process.env.AOP_HOME ?? join(homedir(), ".aop");

  if (!baseEnv.PI_CODING_AGENT_SESSION_DIR) {
    baseEnv.PI_CODING_AGENT_SESSION_DIR = join(aopHome, PI_SESSION_DIR);
  }
  baseEnv[PI_BASH_TIMEOUT_ENV] ??= String(resolvePiBashTimeoutSecs(inactivityTimeoutMs));
  baseEnv[PI_ACCESS_MODE_ENV] = accessMode ?? "full-access";
  baseEnv[PI_GUARDRAIL_EXTENSION_ENV] = installPiGuardrailExtension(aopHome);

  mkdirSync(baseEnv.PI_CODING_AGENT_SESSION_DIR, { recursive: true });
  return baseEnv;
};

const resolvePiBashTimeoutSecs = (inactivityTimeoutMs?: number): number => {
  if (!inactivityTimeoutMs || inactivityTimeoutMs <= 0) return DEFAULT_PI_BASH_TIMEOUT_SECS;
  const inactivityTimeoutSecs = Math.floor(inactivityTimeoutMs / 1000);
  const marginSecs = Math.min(
    PI_BASH_TIMEOUT_MARGIN_SECS,
    Math.max(1, Math.floor(inactivityTimeoutSecs * 0.2)),
  );
  return Math.max(1, inactivityTimeoutSecs - marginSecs);
};

const installPiGuardrailExtension = (aopHome: string): string => {
  const extensionDir = join(aopHome, "runtime", "pi");
  const extensionPath = join(extensionDir, "aop-guardrails.mjs");
  mkdirSync(extensionDir, { recursive: true });
  if (
    !existsSync(extensionPath) ||
    readFileSync(extensionPath, "utf-8") !== PI_GUARDRAIL_EXTENSION_SOURCE
  ) {
    writeFileSync(extensionPath, PI_GUARDRAIL_EXTENSION_SOURCE);
  }
  return extensionPath;
};

const readSessionIdFromLog = (logFilePath: string): string | undefined => {
  if (!existsSync(logFilePath)) {
    return undefined;
  }

  return extractRuntimeSessionIdFromRawJsonl(readFileSync(logFilePath, "utf-8")) ?? undefined;
};
