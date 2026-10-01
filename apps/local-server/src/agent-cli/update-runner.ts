import { access, constants } from "node:fs/promises";
import type { AgentCliUpdate } from "@aop/common";
import { forgetLoginShellEnv } from "@aop/infra";
import type { AgentCliDefinition } from "./definitions.ts";
import { formatCommand, type UpdatePlan } from "./install-method.ts";
import { type CliProbe, messageOf } from "./probe.ts";
import { closeSpawnGate } from "./spawn-gate.ts";
import { isCliUpdateAvailable } from "./version.ts";

const OUTPUT_TAIL_CHARS = 4_000;

export interface UpdateRunnerDeps {
  /** How many runs of the CLI are in flight now. */
  activeRunCount: () => Promise<number>;
  runCommand: (
    argv: string[],
    onOutput: (chunk: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  /** Reads the installed CLI again once the update has run. */
  reprobe: () => Promise<CliProbe>;
  onChange: (patch: Partial<AgentCliUpdate>) => void;
  sleep: (ms: number) => Promise<void>;
  /** How often a deferred update looks again for runs in flight. */
  deferPollMs: number;
  /** The host is shutting down: a deferred update gives up. */
  isStopped: () => boolean;
}

export interface PlannedUpdate {
  definition: AgentCliDefinition;
  plan: UpdatePlan & { command: string[] };
  fromVersion: string | null;
  latest: string | null;
}

/**
 * Runs one update to its end. New launches of the CLI wait at the spawn gate while it runs. An
 * install that cannot be replaced under a running process first waits until no run of the CLI
 * is in flight: the gate is closed before the runs are counted, so none can start between the
 * count and the update. Every outcome lands in `onChange`; nothing here throws.
 */
export const runPlannedUpdate = async (
  update: PlannedUpdate,
  deps: UpdateRunnerDeps,
): Promise<void> => {
  const release = await waitUntilSafe(update, deps);
  if (!release) {
    deps.onChange(failed(update, "The host stopped before the update could run"));
    return;
  }
  let output = "";
  let result: { exitCode: number; output: string };
  try {
    deps.onChange({ state: "updating", deferredFor: 0 });
    result = await deps.runCommand(update.plan.command, (chunk) => {
      output = tail(output + chunk);
      deps.onChange({ output });
    });
  } catch (error) {
    result = { exitCode: -1, output: messageOf(error) };
  } finally {
    release();
  }
  // The login shell's PATH is cached from the first spawn; an installer may have changed it.
  forgetLoginShellEnv();
  const after = await deps.reprobe();
  deps.onChange({ ...outcome(update, result, after), output: tail(result.output) || null });
};

/**
 * A package manager can only write where the person may write: AOP never uses sudo, so an
 * install under a root-owned prefix is refused up front with the command to run by hand.
 */
export const checkWritable = async (
  plan: UpdatePlan,
  realPath: string,
  isWritable: (path: string) => Promise<boolean> = defaultIsWritable,
): Promise<string | null> => {
  if (plan.method !== "npm" && plan.method !== "pnpm" && plan.method !== "bun") return null;
  const index = realPath.indexOf("/node_modules/");
  if (index < 0) return null;
  const directory = realPath.slice(0, index + "/node_modules".length);
  if (await isWritable(directory)) return null;
  return `${directory} is not writable by this user, and AOP never updates with sudo`;
};

const waitUntilSafe = async (
  update: PlannedUpdate,
  deps: UpdateRunnerDeps,
): Promise<(() => void) | null> => {
  while (!deps.isStopped()) {
    const release = closeSpawnGate(update.definition.provider);
    if (update.plan.safeWhileRunning) return release;
    // A count that cannot be read is treated as runs in flight: waiting is the safe side.
    const count = await deps.activeRunCount().catch(() => 1);
    if (count === 0) return release;
    release();
    deps.onChange({ state: "waiting", deferredFor: count });
    await deps.sleep(deps.deferPollMs);
  }
  return null;
};

const outcome = (
  update: PlannedUpdate,
  result: { exitCode: number },
  after: CliProbe,
): Partial<AgentCliUpdate> => {
  const { definition, plan, latest } = update;
  const command = formatCommand(plan.command);
  if (result.exitCode !== 0) {
    const how = result.exitCode < 0 ? "could not run" : `exited with code ${result.exitCode}`;
    return failed(update, `\`${command}\` ${how}`);
  }
  if (!after.version) {
    return failed(
      update,
      `\`${command}\` finished, but ${definition.label} no longer reports a version`,
    );
  }
  if (isCliUpdateAvailable(latest, after.version)) {
    return failed(
      update,
      `\`${command}\` finished, but ${definition.label} is still on ${after.version} ` +
        `(${latest} is out); ${plan.method} may not offer it yet`,
    );
  }
  return {
    state: "succeeded",
    finishedAt: new Date().toISOString(),
    toVersion: after.version,
    error: null,
    manualCommand: null,
  };
};

// `toVersion` stays the version the update was for, so an automatic update that failed is
// not retried for it.
const failed = (update: PlannedUpdate, error: string): Partial<AgentCliUpdate> => ({
  state: "failed",
  finishedAt: new Date().toISOString(),
  deferredFor: 0,
  error,
  manualCommand: update.plan.manualCommand,
});

const tail = (text: string): string => text.slice(-OUTPUT_TAIL_CHARS);

const defaultIsWritable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};
