import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildSpawnEnv, resolveExecHost } from "@aop/infra";
import { PLAYWRIGHT_MCP_VERSION } from "../control-capabilities";
import { extractRuntimeSessionIdFromRawJsonl } from "../logs";
import { assertNativePlanModeSupported } from "../plan-mode";
import { needsControlProcessCleanup, startProcessTreeTracker } from "../process-tree";
import { resolveRuntimeAlias } from "../runtime-alias";
import { sanitizeSessionId } from "../session-id";
import type { LLMProvider, RunOptions, RunResult } from "../types";
import { createLogOutputTimeoutWatchdog, type Watchdog } from "./claude-code";

const CODEX_MODEL_ENV = "AOP_CODEX_MODEL";
const CODEX_REASONING_EFFORT_ENV = "AOP_CODEX_REASONING_EFFORT";
const USER_CODEX_HOME = join(homedir(), ".codex");
const SEEDED_CODEX_FILES = ["auth.json", "config.toml"] as const;
const SEEDED_HOME_FILES = [".gitconfig"] as const;

export class CodexCliProvider implements LLMProvider {
  readonly name = "codex-cli";

  buildCommand(options: RunOptions): string[] {
    assertNativePlanModeSupported(this.name, options.mode);

    // The resume id is replayed as a bare positional to `codex exec resume`;
    // a forged id from a malicious log line must never look like a flag.
    const resumeSessionId = sanitizeSessionId(options.resumeSessionId);
    const cmd = buildCodexExecCommand(
      resolveRuntimeAlias(options.runtimeAlias, "codex"),
      resumeSessionId,
    );
    appendCodexModeFlags(cmd, options, resumeSessionId);
    const model = options.model ?? options.env?.[CODEX_MODEL_ENV];
    if (model) {
      cmd.push("--model", model);
    }

    const reasoningEffort = options.reasoningEffort ?? options.env?.[CODEX_REASONING_EFFORT_ENV];
    if (reasoningEffort) {
      cmd.push("-c", `model_reasoning_effort="${normalizeCodexReasoningEffort(reasoningEffort)}"`);
    }

    if (options.fastMode) {
      cmd.push("--enable", "fast_mode");
    }

    appendAopMcpServer(cmd, options.mcpServerUrl);
    appendControlCapabilities(cmd, options);
    if (resumeSessionId) {
      cmd.push(resumeSessionId);
    }

    cmd.push(options.prompt);
    return cmd;
  }

  async run(options: RunOptions): Promise<RunResult> {
    const spawnEnv = buildSpawnEnv(buildCodexEnv(options.env));

    const proc = (options.execHost ?? resolveExecHost()).spawn({
      cmd: this.buildCommand(options),
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
    // computer_use / browser_use helpers can outlive codex exec; track while
    // the root is alive so cleanup still finds reparented detached children.
    const controlTracker =
      needsControlProcessCleanup(options) && pid ? startProcessTreeTracker(pid) : null;
    const timeout = attachCodexTimeoutWatchdog(proc, options);

    try {
      const exitCode = await proc.exited;
      timeout.watchdog?.stop();

      const sessionId = sanitizeSessionId(
        options.logFilePath ? readSessionIdFromLog(options.logFilePath) : undefined,
      );
      if (sessionId) {
        await options.onSession?.(sessionId);
      }

      return {
        exitCode,
        pid,
        sessionId,
        timedOut: timeout.timedOut,
        ...(timeout.startupTimedOut ? { startupTimedOut: true } : {}),
      };
    } finally {
      await controlTracker?.terminate();
    }
  }
}

const attachCodexTimeoutWatchdog = (
  proc: { kill: () => void },
  options: RunOptions,
): { watchdog?: Watchdog; timedOut: boolean; startupTimedOut: boolean } => {
  const state = {
    timedOut: false,
    startupTimedOut: false,
    watchdog: undefined as Watchdog | undefined,
  };
  const logPath = options.logFilePath;
  if (!logPath || !(options.startupTimeoutMs || options.inactivityTimeoutMs)) return state;

  state.watchdog = createLogOutputTimeoutWatchdog({
    logFilePath: logPath,
    startupTimeoutMs: options.startupTimeoutMs,
    inactivityTimeoutMs: options.inactivityTimeoutMs,
    onTimeout: (kind) => {
      if (kind === "startup") state.startupTimedOut = true;
      else state.timedOut = true;
      proc.kill();
    },
  });
  return state;
};

const buildCodexExecCommand = (
  executable: string,
  resumeSessionId: string | undefined,
): string[] =>
  resumeSessionId ? [executable, "exec", "resume", "--json"] : [executable, "exec", "--json"];

const normalizeCodexReasoningEffort = (reasoningEffort: string): string =>
  reasoningEffort === "extra-high" ? "xhigh" : reasoningEffort;

const appendCodexModeFlags = (
  cmd: string[],
  options: RunOptions,
  resumeSessionId: string | undefined,
): void => {
  // Plan mode must not mutate the repo — codex has no native plan concept,
  // so the read-only sandbox is what makes the planning run safe.
  if (!resumeSessionId && options.mode === "plan") {
    cmd.push("--sandbox", "read-only");
    return;
  }

  if (options.mode === "plan") return;

  const accessMode = options.accessMode ?? "full-access";
  if (accessMode === "approval-required") {
    cmd.push(
      "--ask-for-approval",
      "untrusted",
      "--sandbox",
      "read-only",
      "-c",
      'approvals_reviewer="user"',
    );
    return;
  }
  if (accessMode === "auto-accept-edits") {
    cmd.push(
      "--ask-for-approval",
      "on-request",
      "--sandbox",
      "workspace-write",
      "-c",
      'approvals_reviewer="user"',
    );
    return;
  }
  if (accessMode === "auto") {
    cmd.push(
      "--ask-for-approval",
      "on-request",
      "--sandbox",
      "workspace-write",
      "-c",
      'approvals_reviewer="auto_review"',
    );
    return;
  }
  cmd.push("--dangerously-bypass-approvals-and-sandbox");
  if (options.accessMode) {
    cmd.push("-c", 'approvals_reviewer="user"');
  }
};

const appendAopMcpServer = (cmd: string[], mcpServerUrl?: string): void => {
  const url = mcpServerUrl?.trim();
  if (!url) return;
  cmd.push("-c", `mcp_servers.aop.url=${JSON.stringify(url)}`);
};

const appendControlCapabilities = (cmd: string[], options: RunOptions): void => {
  if (options.browserControl) {
    cmd.push(
      "--enable",
      "browser_use",
      "--enable",
      "browser_use_external",
      "--enable",
      "in_app_browser",
      "-c",
      'mcp_servers.playwright.command="bunx"',
      "-c",
      `mcp_servers.playwright.args=["-y","@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}","--headless","--isolated"]`,
    );
  }
  if (options.computerControl) {
    cmd.push("--enable", "computer_use");
  }
};

const readSessionIdFromLog = (logFilePath: string): string | undefined => {
  if (!existsSync(logFilePath)) {
    return undefined;
  }

  return extractRuntimeSessionIdFromRawJsonl(readFileSync(logFilePath, "utf-8")) ?? undefined;
};

const buildCodexEnv = (extraEnv?: Record<string, string>): Record<string, string> => {
  const baseEnv = {
    ...(extraEnv ?? {}),
  };

  if (!baseEnv.CODEX_HOME) {
    const aopHome = baseEnv.AOP_HOME ?? process.env.AOP_HOME ?? join(homedir(), ".aop");
    baseEnv.CODEX_HOME = join(aopHome, "codex-home");
  }

  if (!baseEnv.HOME) {
    baseEnv.HOME = process.env.HOME ?? homedir();
  }

  mkdirSync(baseEnv.CODEX_HOME, { recursive: true });
  seedCodexHome(baseEnv.CODEX_HOME);
  seedHomeProfile(baseEnv.HOME);
  return baseEnv;
};

const seedCodexHome = (codexHome: string): void => {
  mkdirSync(codexHome, { recursive: true });

  for (const fileName of SEEDED_CODEX_FILES) {
    const sourcePath = join(USER_CODEX_HOME, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    copyFileSync(sourcePath, join(codexHome, fileName));
  }
};

const seedHomeProfile = (homeDir: string): void => {
  mkdirSync(homeDir, { recursive: true });

  for (const fileName of SEEDED_HOME_FILES) {
    const sourcePath = join(homedir(), fileName);
    const targetPath = join(homeDir, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }
    if (sourcePath === targetPath) {
      continue;
    }

    copyFileSync(sourcePath, targetPath);
  }
};
