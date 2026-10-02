import { z } from "zod";
import { CliProviderSchema } from "./projects/runtime.ts";

/*
 * The agent CLIs the host runs sessions with (Claude Code today; Codex and PI join
 * `CliProviderSchema` in Phase 2), what is installed, what is published, and the update the host
 * may run for each. Not to be confused with `UpdateStatus`, which is about AOP itself.
 */

/**
 * How a CLI got onto the machine, which decides how it is updated. `native` is Claude Code's own
 * installer (`~/.local/share/claude/versions`), updated by the CLI itself; the package managers
 * update their global package; `unknown` is anything else, which the host never guesses at.
 */
export const AgentCliInstallMethodSchema = z.enum([
  "native",
  "npm",
  "pnpm",
  "bun",
  "brew",
  "unknown",
]);
export type AgentCliInstallMethod = z.infer<typeof AgentCliInstallMethodSchema>;

/**
 * - `waiting`: queued behind runs in flight, for an install method that cannot be replaced under
 *   a running process (see `deferredFor`).
 * - `updating`: the update command is running; new runs of this CLI wait for it.
 * - `succeeded` / `failed`: the last update's outcome, kept until the next one starts.
 */
export const AgentCliUpdateStateSchema = z.enum([
  "idle",
  "waiting",
  "updating",
  "succeeded",
  "failed",
]);
export type AgentCliUpdateState = z.infer<typeof AgentCliUpdateStateSchema>;

export const AgentCliUpdateSchema = z.object({
  state: AgentCliUpdateStateSchema,
  /** Who asked: the person, or the auto-update setting. */
  trigger: z.enum(["manual", "auto"]).nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  fromVersion: z.string().nullable(),
  toVersion: z.string().nullable(),
  /** While `waiting`: how many runs of this CLI the update waits for. */
  deferredFor: z.number().int().nonnegative(),
  /** Why the update failed or cannot run, in words for the person. */
  error: z.string().nullable(),
  /** The command to run by hand when the host cannot update the CLI itself. */
  manualCommand: z.string().nullable(),
  /** The last lines the update command printed. */
  output: z.string().nullable(),
});
export type AgentCliUpdate = z.infer<typeof AgentCliUpdateSchema>;

export const AgentCliStatusSchema = z.object({
  provider: CliProviderSchema,
  label: z.string(),
  /** The command sessions launch, looked up on the spawn PATH at every launch. */
  command: z.string(),
  installed: z.boolean(),
  /** Where the command resolves on PATH now, and the file it points at. */
  path: z.string().nullable(),
  realPath: z.string().nullable(),
  version: z.string().nullable(),
  installMethod: AgentCliInstallMethodSchema.nullable(),
  /** The command the host runs to update it, or null when it cannot. */
  updateCommand: z.string().nullable(),
  /** The newest published version on the CLI's release channel, from the last check. */
  latest: z.string().nullable(),
  channel: z.string(),
  updateAvailable: z.boolean(),
  checkedAt: z.string().nullable(),
  checkError: z.string().nullable(),
  /** Runs of this CLI in flight, and the versions they started on. */
  activeRuns: z.object({ count: z.number().int().nonnegative(), versions: z.array(z.string()) }),
  /** The version the most recent finished run of this CLI reported. */
  lastRunVersion: z.string().nullable(),
  update: AgentCliUpdateSchema,
});
export type AgentCliStatus = z.infer<typeof AgentCliStatusSchema>;

/**
 * The host owner's "skip permission checks" setting (`agent_cli_skip_permissions`, off by
 * default): while it is on, every Claude Code session the host starts runs with
 * `--dangerously-skip-permissions`. It is read at each launch, so it reaches the next turn.
 */
export const PermissionBypassSchema = z.object({
  enabled: z.boolean(),
  /**
   * Why runs on this host cannot skip permission checks whatever the setting says (Claude Code
   * refuses to as root outside a sandbox), in words for the person; null when they can. While
   * it is set, runs keep their usual checks instead of failing.
   */
  blockedReason: z.string().nullable(),
});
export type PermissionBypass = z.infer<typeof PermissionBypassSchema>;

export const AgentClisResponseSchema = z.object({
  clis: z.array(AgentCliStatusSchema),
  /** Minutes between background checks; 0 means the periodic check is off. */
  checkIntervalMinutes: z.number().int().nonnegative(),
  autoUpdate: z.boolean(),
  skipPermissions: PermissionBypassSchema,
});
export type AgentClisResponse = z.infer<typeof AgentClisResponseSchema>;

export const DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES = 60;
/** A day: often enough for a CLI that ships several times a week, rarely enough to be a ceiling. */
export const MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES = 24 * 60;

/** The check interval a stored setting means, or null when it is not one (0 turns the check off). */
export const parseAgentCliCheckInterval = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const minutes = Number.parseInt(trimmed, 10);
  return minutes <= MAX_AGENT_CLI_CHECK_INTERVAL_MINUTES ? minutes : null;
};
