import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildSpawnEnv, resolveExecHost } from "@aop/infra";
import type { LLMProvider, RunOptions, RunResult } from "../types";
import { createLogOutputTimeoutWatchdog, type Watchdog } from "./claude-code";

const HERMES_PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HERMES_RUNNER_PATH = join(import.meta.dir, "hermes-runner.ts");

export const resolveHermesCliProvider = (model?: string): string | undefined => {
  if (!model) return undefined;

  if (model.startsWith("claude")) {
    return "anthropic";
  }

  return "openai-codex";
};

const readSessionIdFromLog = (logFilePath: string): string | undefined => {
  if (!existsSync(logFilePath)) {
    return undefined;
  }

  const matches = readFileSync(logFilePath, "utf-8").match(/"session_id":"([^"]+)"/g);
  const lastMatch = matches?.at(-1);
  if (!lastMatch) {
    return undefined;
  }

  const sessionIdMatch = lastMatch.match(/"session_id":"([^"]+)"/);
  return sessionIdMatch?.[1];
};

const resolveProfilePath = (profile: string): string => {
  if (profile === "default") {
    return join(homedir(), ".hermes");
  }

  return join(homedir(), ".hermes", "profiles", profile);
};

const assertValidProfile = (profile: string): void => {
  if (profile === "default") {
    return;
  }

  if (!HERMES_PROFILE_RE.test(profile)) {
    throw new Error(`Invalid Hermes profile: ${profile}`);
  }
};

const assertProfileExists = (profile: string): void => {
  const profilePath = resolveProfilePath(profile);
  if (!existsSync(profilePath)) {
    throw new Error(`Hermes profile not found: ${profile}`);
  }
};

export class HermesProvider implements LLMProvider {
  readonly name = "hermes";
  readonly profile?: string;

  constructor(profile?: string) {
    if (profile) {
      assertValidProfile(profile);
    }

    this.profile = profile;
  }

  withProfile(profile?: string): HermesProvider {
    return new HermesProvider(profile);
  }

  buildCommand(options: RunOptions): string[] {
    if (!options.logFilePath) {
      throw new Error("HermesProvider requires logFilePath");
    }

    const cmd = [
      "bun",
      HERMES_RUNNER_PATH,
      "--log-file",
      options.logFilePath,
      "--prompt",
      options.prompt,
    ];

    const profile = this.profile;
    if (profile) {
      cmd.push("--profile", profile);
    }

    if (options.cwd) {
      cmd.push("--cwd", options.cwd);
    }

    if (options.resumeSessionId) {
      cmd.push("--resume-session-id", options.resumeSessionId);
    }

    const hermesProvider = resolveHermesCliProvider(options.model);
    if (hermesProvider) {
      cmd.push("--provider", hermesProvider);
    }

    if (options.model) {
      cmd.push("--model", options.model);
    }

    if (options.reasoningEffort) {
      cmd.push("--reasoning-effort", options.reasoningEffort);
    }

    return cmd;
  }

  async run(options: RunOptions): Promise<RunResult> {
    if (!options.logFilePath) {
      throw new Error("HermesProvider requires logFilePath");
    }

    if (this.profile) {
      assertProfileExists(this.profile);
    }

    const spawnEnv = buildSpawnEnv(options.env);
    const proc = resolveExecHost().spawn({
      cmd: this.buildCommand(options),
      stdout: "ignore",
      stderr: "ignore",
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

    if (options.logFilePath && (options.startupTimeoutMs || options.inactivityTimeoutMs)) {
      watchdog = createLogOutputTimeoutWatchdog({
        logFilePath: options.logFilePath,
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
      sessionId: readSessionIdFromLog(options.logFilePath),
      timedOut,
      ...(startupTimedOut ? { startupTimedOut: true } : {}),
    };
  }
}
