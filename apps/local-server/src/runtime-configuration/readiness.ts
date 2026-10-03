import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
import type { RuntimeAuthState, RuntimeConfigurationProvider, RuntimeStatus } from "@aop/common";
import { buildSpawnEnv } from "@aop/infra";
import { resolveRuntimeExecutable } from "@aop/llm-provider";
import { runWithTimeout } from "../agent-cli/probe.ts";
import { parseCliVersion } from "../agent-cli/version.ts";

/** How long a look at one command stands before it is taken again. */
export const READINESS_CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 10_000;

/** What a status is judged from: the parts of a runtime configuration the host looks at. */
export type ReadinessTarget = Pick<
  RuntimeConfigurationProvider,
  "id" | "name" | "command" | "driver" | "models"
>;

export interface ReadinessDeps {
  /** Where `command` resolves, the way a run's spawn resolves it; null when nothing runs there. */
  locate: (command: string) => string | null;
  /** Runs argv with no terminal and returns its exit code and output; rejects on timeout. */
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; output: string }>;
  now: () => number;
}

export interface RuntimeReadiness {
  /** The runtime's status, from a look at most `READINESS_CACHE_MS` old unless `fresh`. */
  check: (target: ReadinessTarget, options?: { fresh?: boolean }) => Promise<RuntimeStatus>;
  /**
   * Why a turn on `command` cannot start, in words for the chat, or null when it can. A runtime
   * that looked ready recently is trusted; one that did not is looked at again, so a command
   * installed or logged in a moment ago works on the next message.
   */
  blockReason: (command: string, driver: string) => Promise<string | null>;
}

/**
 * Looks at runtimes the way a turn would use them: is the command on the host's PATH, what
 * version it reports, and (for Claude Code) whether it is logged in. Each look runs at most two
 * short commands, so pages and turns can ask often; looks are kept per command and driver.
 */
export const createRuntimeReadiness = (deps: ReadinessDeps = defaultDeps): RuntimeReadiness => {
  const looks = new Map<string, { at: number; look: Promise<CommandLook> }>();

  const lookAt = (command: string, driver: string, fresh: boolean): Promise<CommandLook> => {
    const key = `${driver}\u0000${command}`;
    const kept = looks.get(key);
    if (kept && !fresh && deps.now() - kept.at < READINESS_CACHE_MS) return kept.look;
    const look = probeCommand(deps, command, driver);
    looks.set(key, { at: deps.now(), look });
    return look;
  };

  return {
    check: async (target, options = {}) => {
      const look = await lookAt(target.command, target.driver, options.fresh === true);
      return toStatus(target, look, new Date(deps.now()).toISOString());
    },
    blockReason: async (command, driver) => {
      const kept = await lookAt(command, driver, false);
      const look = reasonOf(command, kept) === null ? kept : await lookAt(command, driver, true);
      return reasonOf(command, look);
    },
  };
};

let shared: RuntimeReadiness | undefined;

/** The one the host uses: looks are shared by the Runtimes page, the pickers and every turn. */
export const hostRuntimeReadiness = (): RuntimeReadiness => {
  shared ??= createRuntimeReadiness();
  return shared;
};

/**
 * What a turn about to launch `alias` (a session's command; null is the driver's own) says in
 * the chat instead of running, or null when it may run.
 */
export const turnBlockReason = async (
  alias: string | null,
  driver: string,
  readiness: RuntimeReadiness = hostRuntimeReadiness(),
): Promise<string | null> => {
  const command = alias?.trim() || DEFAULT_COMMANDS[driver];
  if (!command) return null;
  const reason = await readiness.blockReason(command, driver);
  return reason && `This turn could not start on its runtime. ${reason} ${FIX_HINT}`;
};

const DEFAULT_COMMANDS: Record<string, string> = { "claude-code": "claude" };
const FIX_HINT =
  "Fix it in AOP settings › Runtimes, or pick another runtime in the project's settings › Models.";

interface CommandLook {
  path: string | null;
  version: string | null;
  auth: RuntimeAuthState;
}

const probeCommand = async (
  deps: ReadinessDeps,
  command: string,
  driver: string,
): Promise<CommandLook> => {
  const path = deps.locate(command);
  if (!path) return { path: null, version: null, auth: "unknown" };
  const [version, auth] = await Promise.all([
    readVersion(deps, path),
    driver === "claude-code" ? readClaudeAuth(deps, path) : Promise.resolve("unknown" as const),
  ]);
  return { path, version, auth };
};

const readVersion = async (deps: ReadinessDeps, path: string): Promise<string | null> => {
  try {
    const result = await deps.run([path, "--version"], PROBE_TIMEOUT_MS);
    return result.exitCode === 0 ? parseCliVersion(result.output) : null;
  } catch {
    return null;
  }
};

// `claude auth status` prints JSON with `loggedIn` (Claude Code 2.1). A wrapper that does not
// pass the arguments on, or prints anything else, leaves the login unknown, which does not block.
const readClaudeAuth = async (deps: ReadinessDeps, path: string): Promise<RuntimeAuthState> => {
  try {
    const { output } = await deps.run([path, "auth", "status"], PROBE_TIMEOUT_MS);
    const start = output.indexOf("{");
    const parsed: unknown = JSON.parse(output.slice(start, output.lastIndexOf("}") + 1));
    const loggedIn = (parsed as { loggedIn?: unknown }).loggedIn;
    if (typeof loggedIn !== "boolean") return "unknown";
    return loggedIn ? "logged-in" : "logged-out";
  } catch {
    return "unknown";
  }
};

const toStatus = (target: ReadinessTarget, look: CommandLook, checkedAt: string): RuntimeStatus => {
  const reason =
    reasonOf(target.command, look) ??
    (target.models.length === 0 ? "It has no models: add one in AOP settings › Runtimes." : null);
  return {
    runtimeId: target.id,
    path: look.path,
    version: look.version,
    auth: look.auth,
    ready: reason === null,
    reason,
    checkedAt,
  };
};

const reasonOf = (command: string, look: CommandLook): string | null => {
  if (!look.path) return `The command \`${command}\` was not found on this host's PATH.`;
  if (look.auth === "logged-out") {
    return `\`${command}\` is not logged in. Run it on the host and log in with /login.`;
  }
  return null;
};

const defaultDeps: ReadinessDeps = {
  locate: (command) => {
    const resolved = resolveRuntimeExecutable(command, buildSpawnEnv().PATH);
    // A bare name it could not find comes back as it was; a path is returned without a look.
    if (!isAbsolute(resolved)) return null;
    try {
      accessSync(resolved, constants.X_OK);
      return resolved;
    } catch {
      return null;
    }
  },
  run: (argv, timeoutMs) => runWithTimeout(argv, timeoutMs),
  now: () => Date.now(),
};
