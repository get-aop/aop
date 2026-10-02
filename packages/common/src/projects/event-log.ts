import { z } from "zod";
import { MessageSchema } from "./message.ts";
import { IdSchema } from "./primitives.ts";
import { ProjectSchema } from "./project.ts";
import { RoutineSchema } from "../routines/routine.ts";
import { ThreadSchema } from "./thread.ts";

const EventLogBaseSchema = z.object({
  /** Monotonically increasing; a client resumes the stream with `?after=<last id it saw>`. */
  id: z.number().int().positive(),
  projectId: IdSchema,
});

/**
 * One row of the durable, project-scoped event log. Discriminated on `type`, so a payload can
 * only be the shape its type promises. Entities are carried whole and applied by id (upsert,
 * remove): replaying a range of entries, or the same entry twice, leaves the same state.
 */
const EventLogEntryUnionSchema = z.discriminatedUnion("type", [
  EventLogBaseSchema.extend({
    type: z.literal("project.upserted"),
    payload: z.object({ project: ProjectSchema }),
  }),
  EventLogBaseSchema.extend({ type: z.literal("project.removed"), payload: z.object({}) }),
  EventLogBaseSchema.extend({
    type: z.literal("thread.upserted"),
    payload: z.object({ thread: ThreadSchema }),
  }),
  EventLogBaseSchema.extend({
    type: z.literal("thread.removed"),
    payload: z.object({ threadId: IdSchema }),
  }),
  EventLogBaseSchema.extend({
    type: z.literal("message.created"),
    payload: z.object({ message: MessageSchema }),
  }),
  // A message the host changed after it was created, as when a suggested thread is answered. It
  // carries the whole message as `message.created` does, and a client replaces the one it holds.
  EventLogBaseSchema.extend({
    type: z.literal("message.updated"),
    payload: z.object({ message: MessageSchema }),
  }),
  // A routine was made or changed, or one of its runs began, ended or was skipped.
  EventLogBaseSchema.extend({
    type: z.literal("routine.upserted"),
    payload: z.object({ routine: RoutineSchema }),
  }),
  EventLogBaseSchema.extend({
    type: z.literal("routine.removed"),
    payload: z.object({ routineId: IdSchema }),
  }),
]);

export type EventLogEntry = z.infer<typeof EventLogEntryUnionSchema>;

const payloadProjectId = (entry: EventLogEntry): string | null => {
  switch (entry.type) {
    case "project.upserted":
      return entry.payload.project.id;
    case "thread.upserted":
      return entry.payload.thread.projectId;
    case "message.created":
    case "message.updated":
      return entry.payload.message.projectId;
    case "routine.upserted":
      return entry.payload.routine.projectId;
    default:
      return null;
  }
};

/** An entry's project must be the project of the entity it carries, or a client files it wrong. */
export const EventLogEntrySchema = EventLogEntryUnionSchema.refine(
  (entry) => {
    const owner = payloadProjectId(entry);
    return owner === null || owner === entry.projectId;
  },
  { error: "Event projectId must match the project of its payload" },
);

export type EventLogEntryType = EventLogEntry["type"];
