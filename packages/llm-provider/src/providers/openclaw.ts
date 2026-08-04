import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { buildSpawnEnv, resolveExecHost } from "@aop/infra";
import type { LLMProvider, RunOptions, RunResult } from "../types";
import {
  createFileActivityTracker,
  createLogOutputTimeoutWatchdog,
  fileHasNonEmptyOutput,
  type Watchdog,
} from "./claude-code";

const OPENCLAW_SUCCESS_EXIT_CODE = 0;

interface OpenClawResultLogInput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const getOpenClawRawLogPaths = (logFilePath: string) => ({
  stdout: `${logFilePath}.openclaw.stdout`,
  stderr: `${logFilePath}.openclaw.stderr`,
});

const readRawLog = (path: string): string => {
  if (!existsSync(path)) {
    return "";
  }

  return readFileSync(path, "utf-8");
};

const cleanupRawLog = (path: string): void => {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup only. A stale raw log does not affect task correctness.
  }
};

const trimLogOutput = (value: string): string => value.trim();

const buildResultText = ({
  stdout,
  stderr,
  exitCode,
}: OpenClawResultLogInput): string | undefined => {
  const preferred =
    exitCode === OPENCLAW_SUCCESS_EXIT_CODE ? trimLogOutput(stdout) : trimLogOutput(stderr);
  const fallback =
    exitCode === OPENCLAW_SUCCESS_EXIT_CODE ? trimLogOutput(stderr) : trimLogOutput(stdout);
  const text = preferred || fallback;
  return text || undefined;
};

export const buildOpenClawResultLog = ({
  stdout,
  stderr,
  exitCode,
}: OpenClawResultLogInput): string => {
  const resultText = buildResultText({ stdout, stderr, exitCode });
  const events: Record<string, unknown>[] = [];

  if (exitCode === OPENCLAW_SUCCESS_EXIT_CODE && resultText) {
    events.push({
      provider: "openclaw",
      type: "assistant",
      message: resultText,
    });
  }

  events.push({
    provider: "openclaw",
    type: "result",
    subtype: exitCode === OPENCLAW_SUCCESS_EXIT_CODE ? "success" : "error",
    ...(resultText ? { result: resultText } : {}),
  });

  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
};

export class OpenClawProvider implements LLMProvider {
  readonly name = "openclaw";
  readonly agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  buildCommand(options: RunOptions): string[] {
    const cmd = ["openclaw", "agent", "--agent", this.agentId, "--local"];

    if (options.resumeSessionId) {
      cmd.push("--session-id", options.resumeSessionId);
    }

    if (options.reasoningEffort) {
      cmd.push("--thinking", options.reasoningEffort);
    }

    cmd.push("--message", options.prompt);
    return cmd;
  }

  async run(options: RunOptions): Promise<RunResult> {
    const logFilePath = options.logFilePath;
    const rawPaths = logFilePath ? getOpenClawRawLogPaths(logFilePath) : null;
    const spawnEnv = buildSpawnEnv(options.env);

    const proc = resolveExecHost().spawn({
      cmd: this.buildCommand(options),
      stdout: rawPaths ? { file: rawPaths.stdout } : "ignore",
      stderr: rawPaths ? { file: rawPaths.stderr } : "ignore",
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

    if (rawPaths && (options.startupTimeoutMs || options.inactivityTimeoutMs)) {
      const readStdoutActivity = createFileActivityTracker(rawPaths.stdout);
      const readStderrActivity = createFileActivityTracker(rawPaths.stderr);
      watchdog = createLogOutputTimeoutWatchdog({
        logFilePath: rawPaths.stdout,
        startupTimeoutMs: options.startupTimeoutMs,
        inactivityTimeoutMs: options.inactivityTimeoutMs,
        hasNonEmptyOutput: () =>
          fileHasNonEmptyOutput(rawPaths.stdout) || fileHasNonEmptyOutput(rawPaths.stderr),
        getLastActivity: () => Math.max(readStdoutActivity(), readStderrActivity()),
        onTimeout: (kind) => {
          if (kind === "startup") startupTimedOut = true;
          else timedOut = true;
          proc.kill();
        },
      });
    }

    const exitCode = await proc.exited;
    watchdog?.stop();

    if (logFilePath && rawPaths) {
      const stdout = readRawLog(rawPaths.stdout);
      const stderr = readRawLog(rawPaths.stderr);
      await Bun.write(logFilePath, buildOpenClawResultLog({ stdout, stderr, exitCode }));
      cleanupRawLog(rawPaths.stdout);
      cleanupRawLog(rawPaths.stderr);
    }

    return {
      exitCode,
      pid,
      timedOut,
      ...(startupTimedOut ? { startupTimedOut: true } : {}),
    };
  }
}
