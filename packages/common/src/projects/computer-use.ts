import { z } from "zod";

/**
 * Where a project's threads get computer and browser use from. `model-default` adds nothing, so a
 * thread has whatever its agent CLI brings by itself. `cua` gives threads CUA Driver's MCP tools
 * (https://github.com/trycua/cua). `codex` and `claude` are named so clients can show them as
 * coming, but no project can hold them yet: see `ComputerUseSchema`.
 */
export const ComputerUseOptionSchema = z.enum(["model-default", "cua", "codex", "claude"]);
export type ComputerUseOption = z.infer<typeof ComputerUseOptionSchema>;

/**
 * The CUA Driver release this AOP release installs and upgrades to (`aop computer-use setup`,
 * the install script). Bumped with AOP, so a host update can bring a newer driver along.
 */
export const CUA_DRIVER_VERSION = "0.32.0";

/** The options a project can hold today. */
export const AVAILABLE_COMPUTER_USE = ["model-default", "cua"] as const;
export const ComputerUseSchema = z.enum(AVAILABLE_COMPUTER_USE);
export type ComputerUse = z.infer<typeof ComputerUseSchema>;

/** What `PUT /api/projects/:id/computer-use` takes. Any option parses; the host refuses the ones not available yet. */
export const ComputerUseInputSchema = z.object({ computerUse: ComputerUseOptionSchema });
export type ComputerUseInput = z.infer<typeof ComputerUseInputSchema>;

/**
 * Whether CUA Driver can serve a thread on the AOP host: the machine whose local-server spawns the
 * agent sessions, whatever device shows the dashboard.
 *
 * - `ready`: installed, it answers, its app is running, and it has every macOS permission it needs.
 * - `not-installed`: no `cua-driver` on the host.
 * - `not-ready`: installed but something is missing; `reason` says what.
 *
 * Only `ready` gives threads the tools. Anything else starts their runs without them.
 */
export const CuaReadinessSchema = z.enum(["ready", "not-installed", "not-ready"]);
export type CuaReadiness = z.infer<typeof CuaReadinessSchema>;

/**
 * Why CUA Driver is or is not ready, as a code. `no-answer`: `cua-driver` is there but did not
 * report a version or a permission report. `not-running`: its app (the daemon that holds the
 * macOS grants) is not running, so the grants cannot be read. `missing-permissions`: the app runs
 * without Accessibility or Screen Recording. `no-display`: on Linux, no X display is up for it to
 * drive (`aop computer-use setup` makes a virtual one).
 */
export const CuaReasonSchema = z.enum([
  "ready",
  "not-installed",
  "no-answer",
  "not-running",
  "missing-permissions",
  "no-display",
]);
export type CuaReason = z.infer<typeof CuaReasonSchema>;

/**
 * One thing the host checked. `ok` is null when it was not checked: off macOS there are no grants
 * to read, and some checks (Tahoe's direct capture consent) cannot be read without a prompt.
 * `required` checks decide readiness; the others only inform.
 */
export const CuaCheckSchema = z.object({
  id: z.enum([
    "installed",
    "answers",
    "running",
    "accessibility",
    "screen-recording",
    "direct-capture",
    "up-to-date",
    "display",
    "window-manager",
    "browser",
    "system-packages",
  ]),
  label: z.string(),
  required: z.boolean(),
  ok: z.boolean().nullable(),
  detail: z.string(),
});
export type CuaCheck = z.infer<typeof CuaCheckSchema>;

/**
 * How to fix what the host lacks for computer use. `command` (`aop computer-use setup`) installs or
 * upgrades CUA Driver at the version AOP pins and, on Linux, sets up the virtual display; it needs
 * no root. `sudoCommand` installs the system packages it cannot install by itself (the X server,
 * window manager, libraries and a browser CUA Driver accepts), as ONE command the person runs;
 * null when nothing needs root. `missing` names each missing piece, for a checklist.
 */
export const CuaFixSchema = z.object({
  command: z.string().nullable(),
  sudoCommand: z.string().nullable(),
  missing: z.array(z.string()),
  /** The CUA Driver version this AOP release installs. */
  pinnedVersion: z.string(),
});
export type CuaFix = z.infer<typeof CuaFixSchema>;

export const CuaStatusSchema = z.object({
  status: CuaReadinessSchema,
  reason: CuaReasonSchema,
  /** One sentence on the status, for the person. */
  detail: z.string(),
  /** The `cua-driver` a thread would launch; null when none is found. */
  path: z.string().nullable(),
  version: z.string().nullable(),
  /** The newest release on the driver's update channel, when it could say; null otherwise. */
  latestVersion: z.string().nullable(),
  checks: z.array(CuaCheckSchema),
  /** What fixes what is missing, run on the host: see `CuaFixSchema`. */
  fix: CuaFixSchema,
  /** The machine all of this is about, so a remote dashboard can say where to run commands. */
  host: z.object({ name: z.string(), platform: z.string() }),
  checkedAt: z.iso.datetime({ offset: true }),
});
export type CuaStatus = z.infer<typeof CuaStatusSchema>;
