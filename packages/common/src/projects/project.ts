import { z } from "zod";
import { IdSchema, TimestampSchema } from "./primitives.ts";
import { RuntimePreferenceSchema } from "./runtime.ts";

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

/** What a person edits in project settings, and what creating a project takes. */
export const ProjectSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  goal: z.string().max(PROJECT_GOAL_MAX_LENGTH),
  /** Sent to the coordinator and to every new thread. */
  instructions: z.string().max(PROJECT_INSTRUCTIONS_MAX_LENGTH),
  coordinator: RuntimePreferenceSchema,
  thread: RuntimePreferenceSchema,
  notificationLevel: NotificationLevelSchema,
  repoIds: z.array(IdSchema).refine((ids) => new Set(ids).size === ids.length, {
    error: "A repo can be attached to a project once",
  }),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const ProjectSchema = ProjectSettingsSchema.extend({
  id: IdSchema,
  /** Changed by pause, archive, and restore actions, never by editing settings. */
  status: ProjectStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectPatchSchema = ProjectSettingsSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { error: "At least one project setting is required" },
);
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;
