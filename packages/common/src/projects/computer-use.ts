import { z } from "zod";

/**
 * Where a project's threads get computer and browser use from. `model-default` adds nothing, so a
 * thread has whatever its agent CLI brings by itself. `cua` gives threads CUA Driver's MCP tools
 * (https://github.com/trycua/cua). `codex` and `claude` are named so clients can show them as
 * coming, but no project can hold them yet: see `ComputerUseSchema`.
 */
export const ComputerUseOptionSchema = z.enum(["model-default", "cua", "codex", "claude"]);
export type ComputerUseOption = z.infer<typeof ComputerUseOptionSchema>;

/** The options a project can hold today. */
export const AVAILABLE_COMPUTER_USE = ["model-default", "cua"] as const;
export const ComputerUseSchema = z.enum(AVAILABLE_COMPUTER_USE);
export type ComputerUse = z.infer<typeof ComputerUseSchema>;

/** What `PUT /api/projects/:id/computer-use` takes. Any option parses; the host refuses the ones not available yet. */
export const ComputerUseInputSchema = z.object({ computerUse: ComputerUseOptionSchema });
export type ComputerUseInput = z.infer<typeof ComputerUseInputSchema>;

/**
 * Whether CUA Driver can serve a thread on this host, as the host last saw it.
 *
 * - `ready`: installed, and its daemon reports Accessibility and Screen Recording granted.
 * - `not-running`: installed, but its daemon is not running, so the grants cannot be read. A
 *   thread still gets the tools: CUA Driver starts its app on first use.
 * - `not-installed`: no `cua-driver` on the host's PATH or in /Applications.
 * - `missing-permissions`: the daemon runs without one of the macOS grants it needs.
 * - `error`: `cua-driver` is there but did not answer.
 *
 * Only `not-installed`, `missing-permissions` and `error` keep the tools from a thread.
 */
export const CuaStateSchema = z.enum([
  "ready",
  "not-running",
  "not-installed",
  "missing-permissions",
  "error",
]);
export type CuaState = z.infer<typeof CuaStateSchema>;

export const CuaStatusSchema = z.object({
  state: CuaStateSchema,
  /** Whether a thread of a project on CUA gets the tools now. */
  usable: z.boolean(),
  /** The `cua-driver` a thread would launch; null when none is found. */
  path: z.string().nullable(),
  version: z.string().nullable(),
  /** One sentence on the state, for the person. */
  detail: z.string(),
  /** What the person runs on the host to fix it, in order; empty when there is nothing to do. */
  fix: z.array(z.string()),
});
export type CuaStatus = z.infer<typeof CuaStatusSchema>;
