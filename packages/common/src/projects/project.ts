import { z } from "zod";
import { ComputerUseSchema } from "./computer-use.ts";
import { IdSchema, TimestampSchema } from "./primitives.ts";
import { ReasoningEffortSchema, RuntimePreferenceSchema } from "./runtime.ts";

export const PROJECT_GOAL_MAX_LENGTH = 8000;
export const PROJECT_INSTRUCTIONS_MAX_LENGTH = 16000;

export const ProjectStatusSchema = z.enum(["active", "paused", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/**
 * When the desktop client raises an OS notification. `coordinator` is the default: a coordinator
 * post, a thread error, or a thread that needs the user. `every-turn` adds each finished thread turn.
 */
export const NotificationLevelSchema = z.enum(["coordinator", "every-turn", "off"]);
export type NotificationLevel = z.infer<typeof NotificationLevelSchema>;

/**
 * How much a project's threads may do without asking. `full-access` lets a thread run any
 * command on the host and is what a new project starts with; `auto-accept-edits` lets a thread
 * edit files in its workspace and denies the commands that run code or change things, while
 * read-only ones like `git status` still run (no approval prompt exists). Only the
 * person changes it, per project: no tool the coordinator holds can. The coordinator itself
 * always runs `approval-required`, whatever a project chooses.
 */
export const ThreadAccessSchema = z.enum(["auto-accept-edits", "full-access"]);
export type ThreadAccess = z.infer<typeof ThreadAccessSchema>;

/**
 * The icons a project can wear instead of its first letter. A small fixed set, so every client
 * draws the same picture for the same name; the dashboard maps each to its glyph.
 */
export const ProjectIconSchema = z.enum([
  "box",
  "folder",
  "code",
  "terminal",
  "rocket",
  "bug",
  "book",
  "flask",
  "globe",
  "database",
  "shield",
  "sparkles",
]);
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;

/** The colours a project's tile can take; each is a muted hue the dashboard draws in both themes. */
export const ProjectColorSchema = z.enum([
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "teal",
  "yellow",
  "indigo",
]);
export type ProjectColor = z.infer<typeof ProjectColorSchema>;

/** What a person edits in project settings, and what creating a project takes. */
export const ProjectSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** Null draws the name's first letter: the tile a project has until someone picks an icon. */
  icon: ProjectIconSchema.nullable(),
  /** Null takes a colour from the project's id, so projects without one still tell apart. */
  color: ProjectColorSchema.nullable(),
  goal: z.string().max(PROJECT_GOAL_MAX_LENGTH),
  /** Sent to the coordinator and to every new thread. */
  instructions: z.string().max(PROJECT_INSTRUCTIONS_MAX_LENGTH),
  coordinator: RuntimePreferenceSchema,
  thread: RuntimePreferenceSchema,
  notificationLevel: NotificationLevelSchema,
  threadAccess: ThreadAccessSchema,
  /**
   * Whether the server sends a thread a fix prompt by itself when its pull request has failing
   * checks, a review that requests changes, or merge conflicts. Off leaves those to the person.
   */
  autoFixPullRequests: z.boolean(),
  /**
   * Whether a thread a usage limit stopped takes up its work by itself when the limit resets.
   * Off leaves it waiting past the reset until the person resumes it. The coordinator always
   * resumes, since it has no Resume of its own and its inbox waits on it.
   */
  autoContinue: z.boolean(),
  repoIds: z.array(IdSchema).refine((ids) => new Set(ids).size === ids.length, {
    error: "A repo can be attached to a project once",
  }),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/**
 * What a role's last run reported it ran on, read from the run's log. Only a run launched on
 * "Use default" reports: it is how "Default (Opus 5.5)" learns what the default is. The model is
 * the CLI's own id; the effort stays null while the log names none. Null until a run reports.
 */
export const ReportedRuntimeSchema = z.object({
  model: z.string().min(1).nullable(),
  effort: ReasoningEffortSchema.nullable(),
});
export type ReportedRuntime = z.infer<typeof ReportedRuntimeSchema>;

const NOTHING_REPORTED: ReportedRuntime = { model: null, effort: null };

export const ProjectSchema = ProjectSettingsSchema.extend({
  id: IdSchema,
  /** Changed by pause, archive, and restore actions, never by editing settings. */
  status: ProjectStatusSchema,
  /**
   * Where threads get computer and browser use from. Changed only by the host owner through its
   * own route (PUT /api/projects/:id/computer-use), never by editing settings, and never by the
   * coordinator. A project stored before the setting existed reads as `model-default`.
   */
  computerUse: ComputerUseSchema.default("model-default"),
  /** Written by the host after a run, never by editing settings. */
  reportedRuntime: z
    .object({ coordinator: ReportedRuntimeSchema, thread: ReportedRuntimeSchema })
    .default({ coordinator: NOTHING_REPORTED, thread: NOTHING_REPORTED }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

const { shape } = ProjectSettingsSchema;

/**
 * What a client sends to create a project: only the name is required. The rest starts at Claude
 * Projects' own defaults: a quiet coordinator (low effort), thinking threads (high effort), the
 * provider's default model, and threads with full access (any command on the host).
 *
 * `lookAround` is not a setting but what happens once, on creation: the coordinator welcomes the
 * person and, with a repository, one read-only thread looks at the project so the coordinator
 * can propose threads. It spends usage, so a client asks for it: the dashboard's New project
 * dialog does by default, and a call that leaves it out gets a project that stays quiet.
 */
export const CreateProjectInputSchema = ProjectSettingsSchema.extend({
  icon: shape.icon.default(null),
  color: shape.color.default(null),
  goal: shape.goal.default(""),
  instructions: shape.instructions.default(""),
  coordinator: shape.coordinator.default({ provider: "claude-code", model: null, effort: "low" }),
  thread: shape.thread.default({ provider: "claude-code", model: null, effort: "high" }),
  notificationLevel: shape.notificationLevel.default("coordinator"),
  threadAccess: shape.threadAccess.default("full-access"),
  autoFixPullRequests: shape.autoFixPullRequests.default(true),
  autoContinue: shape.autoContinue.default(true),
  repoIds: shape.repoIds.default([]),
  lookAround: z.boolean().default(false),
});
export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>;

export const ProjectPatchSchema = ProjectSettingsSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { error: "At least one project setting is required" },
);
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;
