import {
  describeSchedule,
  type Routine,
  RoutineCatchUpSchema,
  RoutineInputSchema,
  RoutinePatchSchema,
  RoutineScheduleSchema,
  RoutineTargetSchema,
} from "@aop/common";
import { z } from "zod";
import { describeServiceError } from "../project/errors.ts";
import { describeRoutineError } from "../routine/service.ts";
import type { RoutineResult } from "../routine/types.ts";
import { defineTool, type McpToolCall, McpToolError, textResult } from "./registry.ts";

/*
 * Routines through the coordinator: the person asks in chat ("every weekday at 9, summarize new
 * issues") and the coordinator sets it up. The host's caps apply as they do to the person's own
 * form: how often a routine may run and how many a project may have on are settings only the
 * host owner changes. A thread can only propose one; the coordinator asks the person first.
 */

const SCHEDULE_HELP =
  'When it runs, on the host\'s clock: {kind:"daily",time:"09:00"}, {kind:"weekdays",time:"09:00"}, {kind:"weekly",days:[5],time:"17:00"} (0 = Sunday), {kind:"hourly",every:2,minute:0} (every 2 hours from midnight), or {kind:"cron",expression:"0 9 1 * *"} for anything else.';

const projectIdOf = ({ session }: McpToolCall): string => {
  if (!session.project_id)
    throw new McpToolError("This session belongs to no project", "NO_PROJECT");
  return session.project_id;
};

const unwrap = <T>(result: RoutineResult<T>): T => {
  if (result.success) return result;
  throw new McpToolError(describeRoutineError(result.error), result.error.code);
};

const summarize = (routine: Routine) => ({
  id: routine.id,
  name: routine.name,
  enabled: routine.enabled,
  schedule: routine.schedule,
  when: describeSchedule(routine.schedule),
  target: routine.target,
  repoId: routine.repoId,
  nextRunAt: routine.nextRunAt,
  lastRun: routine.lastRun
    ? {
        status: routine.lastRun.status,
        at: routine.lastRun.occurrence,
        reason: routine.lastRun.reason,
        threadId: routine.lastRun.threadId,
      }
    : null,
});

const RoutineFieldsInput = {
  name: RoutineInputSchema.shape.name.describe("A short name the person will recognise."),
  prompt: RoutineInputSchema.shape.prompt.describe(
    "The brief every run gets. A run cannot see this conversation or earlier runs, so make it complete: what to look at, what to produce, where to report it.",
  ),
  schedule: RoutineScheduleSchema.describe(SCHEDULE_HELP),
  target: RoutineTargetSchema.optional().describe(
    "thread (the default) starts a new thread with the brief each run; coordinator sends it to you as a message, for work you route yourself.",
  ),
  repoId: z
    .string()
    .nullable()
    .optional()
    .describe("A thread's repository. Required when the project has several."),
  catchUp: RoutineCatchUpSchema.optional().describe(
    "Runs missed while the host was off: skip (the default) records them as missed; run-once runs once when the host is back.",
  ),
};

export const routineCreateTool = defineTool({
  name: "routine_create",
  description:
    "Put recurring work on a schedule when the person asks for it, like a morning digest, a weekly report or an hourly CI check. Each run starts a new thread with the brief (or sends it to you). Routines run at most every 15 minutes unless the host owner allows more, and a project has a cap on routines turned on. Confirm the schedule in plain words with the person.",
  input: z.object({
    ...RoutineFieldsInput,
    paused: z.boolean().optional().describe("Create it paused, to be turned on later."),
  }),
  handler: async ({ paused, ...args }, call) => {
    const input = RoutineInputSchema.parse({ ...args, enabled: paused !== true });
    const { routine } = unwrap(
      await call.services.routines.create(projectIdOf(call), input, "coordinator"),
    );
    return textResult(summarize(routine));
  },
});

export const routineListTool = defineTool({
  name: "routine_list",
  description:
    "List this project's routines: what each does, when it runs in plain words, whether it is on, its next run and how its last run went.",
  input: z.object({}),
  handler: async (_args, call) => {
    const listed = unwrap(await call.services.routines.list(projectIdOf(call)));
    return textResult({
      timeZone: listed.timeZone,
      limits: listed.limits,
      routines: listed.routines.map(summarize),
    });
  },
});

export const routineUpdateTool = defineTool({
  name: "routine_update",
  description:
    "Change a routine when the person asks: its name, brief, schedule, target, repository or catch-up rule. Send only what changes. A new schedule counts from now.",
  input: z.object({
    routineId: z.string(),
    name: RoutineFieldsInput.name.optional(),
    prompt: RoutineFieldsInput.prompt.optional(),
    schedule: RoutineFieldsInput.schedule.optional(),
    target: RoutineFieldsInput.target,
    repoId: RoutineFieldsInput.repoId,
    catchUp: RoutineFieldsInput.catchUp,
  }),
  handler: async ({ routineId, ...fields }, call) => {
    const patch = RoutinePatchSchema.safeParse(fields);
    if (!patch.success) throw new McpToolError("Send at least one field to change", "INVALID_INPUT");
    const { routine } = unwrap(
      await call.services.routines.update(projectIdOf(call), routineId, patch.data),
    );
    return textResult(summarize(routine));
  },
});

export const routinePauseTool = defineTool({
  name: "routine_pause",
  description:
    "Pause a routine (it stops running, and keeps its settings and history), or turn it back on with paused: false; turned back on, it next runs at its next scheduled time.",
  input: z.object({
    routineId: z.string(),
    paused: z.boolean().optional().describe("true (the default) pauses; false turns it back on."),
  }),
  handler: async ({ routineId, paused }, call) => {
    const { routine } = unwrap(
      await call.services.routines.update(projectIdOf(call), routineId, {
        enabled: paused === false,
      }),
    );
    return textResult(summarize(routine));
  },
});

export const routineDeleteTool = defineTool({
  name: "routine_delete",
  description:
    "Delete a routine and its run history, when the person asks. Threads it started stay. To stop it for a while, pause it instead.",
  input: z.object({ routineId: z.string() }),
  handler: async ({ routineId }, call) => {
    unwrap(await call.services.routines.remove(projectIdOf(call), routineId));
    return textResult("Routine deleted.");
  },
});

export const routineRunNowTool = defineTool({
  name: "routine_run_now",
  description:
    "Run a routine once now, outside its schedule, when the person wants to see it work. Refused while its last run is still working.",
  input: z.object({ routineId: z.string() }),
  handler: async ({ routineId }, call) => {
    const { run } = unwrap(await call.services.routines.runNow(projectIdOf(call), routineId));
    return textResult(run);
  },
});

export const proposeRoutineTool = defineTool({
  name: "aop_propose_routine",
  description:
    "Suggest recurring work you noticed would be worth doing on a schedule (a weekly dependency check, a daily triage). It goes to the coordinator, which asks the person before setting anything up; nothing runs on its own. Keep working after calling it.",
  input: z.object({
    ...RoutineFieldsInput,
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("One or two sentences for the person: why this is worth doing regularly."),
  }),
  handler: async ({ reason, ...proposal }, call) => {
    const { session } = call;
    const projectId = projectIdOf(call);
    const preview = await call.services.routines.preview(proposal.schedule);
    if (preview.problem) throw new McpToolError(preview.problem, "ROUTINE_TOO_FREQUENT");
    const text = [
      `Thread "${session.title}" (${session.id}) proposes a routine. Ask the person before creating it with routine_create; nothing runs until you do.`,
      `Why: ${reason}`,
      `Proposal (${preview.description}): ${JSON.stringify(proposal)}`,
    ].join("\n\n");
    const sent = await call.services.projects.sendToCoordinator(projectId, text, {
      origin: { type: "routine-proposal", threadId: session.id },
      midRunMode: "queue",
    });
    if (!sent.success)
      throw new McpToolError(describeServiceError(sent.error), sent.error.code);
    return textResult(
      "Proposal sent to the coordinator, which will ask the person. Carry on with your work.",
    );
  },
});
