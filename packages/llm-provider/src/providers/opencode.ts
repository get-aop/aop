import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildSpawnEnv, resolveExecHost } from "@aop/infra";
import { extractRuntimeSessionIdFromRawJsonl } from "../logs";
import { assertNativePlanModeSupported } from "../plan-mode";
import { resolveRuntimeAlias } from "../runtime-alias";
import { sanitizeSessionId } from "../session-id";
import type { LLMProvider, RunOptions, RunResult } from "../types";
import { createLogOutputTimeoutWatchdog, type Watchdog } from "./claude-code";

const OPENCODE_MODEL_ENV = "AOP_OPENCODE_MODEL";
const OPENCODE_VARIANT_ENV = "AOP_OPENCODE_VARIANT";
const OPENCODE_SESSION_DIR = "opencode";
const USER_OPENCODE_AUTH = join(homedir(), ".local", "share", "opencode", "auth.json");
const USER_OPENCODE_CONFIG = join(homedir(), ".config", "opencode", "opencode.json");
const ALLOWED_VARIANTS = ["low", "medium", "high", "xhigh", "max"];

export interface OpenCodeRuntimeAdapter {
  launch(options: RunOptions & { defaultModel: string }): Promise<RunResult>;
}

export class OpenCodeProvider implements LLMProvider {
  readonly name = "opencode";
  readonly model: string;

  private readonly commandAdapter = new OpenCodeCliRuntimeAdapter();

  constructor(
    model: string,
    private readonly runtime: OpenCodeRuntimeAdapter = new OpenCodeCliRuntimeAdapter(),
  ) {
    this.model = model;
  }

  buildCommand(options: RunOptions): string[] {
    return this.commandAdapter.buildCommand({ ...options, defaultModel: this.model });
  }

  async run(options: RunOptions): Promise<RunResult> {
    return this.runtime.launch({ ...options, defaultModel: this.model });
  }
}

export class OpenCodeCliRuntimeAdapter implements OpenCodeRuntimeAdapter {
  buildCommand(options: RunOptions & { defaultModel: string }): string[] {
    assertNativePlanModeSupported("opencode", options.mode);

    const rawModel = options.model ?? options.env?.[OPENCODE_MODEL_ENV] ?? options.defaultModel;
    const { baseModel, variant: modelVariant } = splitModelAndVariant(rawModel);
    const variant =
      modelVariant ??
      mapReasoningEffortToVariant(options.reasoningEffort) ??
      options.env?.[OPENCODE_VARIANT_ENV];

    const cmd = [
      resolveRuntimeAlias(options.runtimeAlias, "opencode"),
      "run",
      "--model",
      baseModel,
      "--format",
      "json",
    ];
    if ((options.accessMode ?? "full-access") === "full-access") {
      cmd.push("--dangerously-skip-permissions");
    }

    if (options.mode === "plan") {
      cmd.push("--agent", "plan");
    }

    if (variant) {
      cmd.push("--variant", variant);
    }

    if (options.resumeSessionId) {
      cmd.push("--session", options.resumeSessionId);
    }

    cmd.push(options.prompt);
    return cmd;
  }

  async launch(options: RunOptions & { defaultModel: string }): Promise<RunResult> {
    const spawnEnv = buildSpawnEnv(buildOpenCodeEnv(options.env));
    applyOpenCodePermissionPolicy(spawnEnv, options.accessMode);

    const logPath = options.logFilePath;
    const proc = (options.execHost ?? resolveExecHost()).spawn({
      cmd: this.buildCommand(options),
      stdout: logPath ? { file: logPath } : "ignore",
      stderr: logPath ? { file: `${logPath}.stderr` } : "ignore",
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

    const sessionId = sanitizeSessionId(logPath ? readSessionIdFromLog(logPath) : undefined);
    if (sessionId) {
      await options.onSession?.(sessionId);
    }

    return {
      exitCode,
      pid,
      sessionId,
      timedOut,
      ...(startupTimedOut ? { startupTimedOut: true } : {}),
    };
  }
}

const buildOpenCodeEnv = (extraEnv?: Record<string, string>): Record<string, string> => {
  const baseEnv = { ...(extraEnv ?? {}) };

  if (!baseEnv.OPENCODE_CONFIG_DIR) {
    const aopHome = baseEnv.AOP_HOME ?? process.env.AOP_HOME ?? join(homedir(), ".aop");
    baseEnv.OPENCODE_CONFIG_DIR = join(aopHome, OPENCODE_SESSION_DIR);
  }

  mkdirSync(baseEnv.OPENCODE_CONFIG_DIR, { recursive: true });
  seedOpenCodeConfig(baseEnv.OPENCODE_CONFIG_DIR);
  return baseEnv;
};

const seedOpenCodeConfig = (configDir: string): void => {
  if (existsSync(USER_OPENCODE_AUTH)) {
    copyFileSync(USER_OPENCODE_AUTH, join(configDir, "auth.json"));
  }

  if (existsSync(USER_OPENCODE_CONFIG)) {
    copyFileSync(USER_OPENCODE_CONFIG, join(configDir, "opencode.json"));
  }
};

const mapReasoningEffortToVariant = (reasoningEffort?: string): string | undefined => {
  if (!reasoningEffort) return undefined;
  if (reasoningEffort === "xhigh" || reasoningEffort === "extra-high") return "xhigh";
  if (ALLOWED_VARIANTS.includes(reasoningEffort)) return reasoningEffort;
  return undefined;
};

const splitModelAndVariant = (rawModel: string): { baseModel: string; variant?: string } => {
  const parts = rawModel.split("/");
  const lastPart = parts.at(-1) ?? "";
  if (!ALLOWED_VARIANTS.includes(lastPart)) {
    return { baseModel: rawModel };
  }

  const baseModel = parts.slice(0, -1).join("/");
  return { baseModel, variant: lastPart };
};

const applyOpenCodePermissionPolicy = (
  env: Record<string, string>,
  accessMode: RunOptions["accessMode"],
): void => {
  env.OPENCODE_PERMISSION = openCodePermissionPolicy(accessMode ?? "full-access");
};

const openCodePermissionPolicy = (accessMode: NonNullable<RunOptions["accessMode"]>): string => {
  if (accessMode === "approval-required" || accessMode === "auto") return '{"*":"ask"}';
  if (accessMode === "auto-accept-edits") {
    return '{"edit":"allow","write":"allow","*":"ask"}';
  }
  return '{"*":"allow"}';
};

const readSessionIdFromLog = (logFilePath: string): string | undefined => {
  if (!existsSync(logFilePath)) {
    return undefined;
  }

  return extractRuntimeSessionIdFromRawJsonl(readFileSync(logFilePath, "utf-8")) ?? undefined;
};
