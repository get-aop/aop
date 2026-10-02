import {
  type ParsedRoutineInput,
  type ReasoningEffort,
  type Routine,
  type RoutineCatchUp,
  RoutineInputSchema,
  type RoutineSchedule,
  type RoutineScheduleKind,
  RoutineScheduleSchema,
  type RoutineTarget,
} from "@aop/common";

/**
 * What the routine form holds: every field of every schedule kind, so switching kinds keeps
 * what the person typed. `draftToInput` picks the ones the chosen kind uses.
 */
export interface RoutineDraft {
  name: string;
  prompt: string;
  kind: RoutineScheduleKind;
  time: string;
  days: number[];
  every: number;
  minute: number;
  expression: string;
  target: RoutineTarget;
  repoId: string | null;
  model: string | null;
  effort: ReasoningEffort | null;
  catchUp: RoutineCatchUp;
  enabled: boolean;
}

export const SCHEDULE_KIND_LABEL: Record<RoutineScheduleKind, string> = {
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Weekly on",
  hourly: "Every N hours",
  cron: "Custom (cron)",
};

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const emptyDraft = (repoId: string | null): RoutineDraft => ({
  name: "",
  prompt: "",
  kind: "weekdays",
  time: "09:00",
  days: [1],
  every: 2,
  minute: 0,
  expression: "0 9 * * 1-5",
  target: "thread",
  repoId,
  model: null,
  effort: null,
  catchUp: "skip",
  enabled: true,
});

export const draftFromRoutine = (routine: Routine): RoutineDraft => ({
  ...emptyDraft(routine.repoId),
  ...scheduleFields(routine.schedule),
  name: routine.name,
  prompt: routine.prompt,
  target: routine.target,
  model: routine.model,
  effort: routine.effort,
  catchUp: routine.catchUp,
  enabled: routine.enabled,
});

/** A copy to save as a new routine: same work and schedule, its own name, starting paused. */
export const duplicateDraft = (routine: Routine): RoutineDraft => ({
  ...draftFromRoutine(routine),
  name: `${routine.name} (copy)`.slice(0, 120),
  enabled: false,
});

export const draftSchedule = (draft: RoutineDraft): RoutineSchedule => {
  switch (draft.kind) {
    case "daily":
      return { kind: "daily", time: draft.time };
    case "weekdays":
      return { kind: "weekdays", time: draft.time };
    case "weekly":
      return { kind: "weekly", days: [...draft.days].sort((a, b) => a - b), time: draft.time };
    case "hourly":
      return { kind: "hourly", every: draft.every, minute: draft.minute };
    case "cron":
      return { kind: "cron", expression: draft.expression };
  }
};

export const draftToInput = (draft: RoutineDraft): ParsedRoutineInput => ({
  name: draft.name,
  prompt: draft.prompt,
  schedule: draftSchedule(draft),
  target: draft.target,
  repoId: draft.target === "thread" ? draft.repoId : null,
  model: draft.target === "thread" ? draft.model : null,
  effort: draft.target === "thread" ? draft.effort : null,
  catchUp: draft.catchUp,
  enabled: draft.enabled,
});

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  prompt: "What it does",
  schedule: "Schedule",
};

/** What is wrong with the draft, per field, in a sentence; empty when the host would take it. */
export const draftProblems = (draft: RoutineDraft): Record<string, string> => {
  const problems: Record<string, string> = {};
  const parsed = RoutineInputSchema.safeParse(draftToInput(draft));
  if (parsed.success) return problems;
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "");
    if (problems[field]) continue;
    problems[field] =
      issue.code === "too_small" && issue.origin === "string"
        ? `${FIELD_LABELS[field] ?? field} is required.`
        : issue.message;
  }
  return problems;
};

/** Whether the schedule parses, so it is worth asking the host for a preview. */
export const scheduleIsValid = (draft: RoutineDraft): boolean =>
  RoutineScheduleSchema.safeParse(draftSchedule(draft)).success;

const scheduleFields = (schedule: RoutineSchedule): Partial<RoutineDraft> => {
  switch (schedule.kind) {
    case "daily":
    case "weekdays":
      return { kind: schedule.kind, time: schedule.time };
    case "weekly":
      return { kind: "weekly", days: [...schedule.days], time: schedule.time };
    case "hourly":
      return { kind: "hourly", every: schedule.every, minute: schedule.minute };
    case "cron":
      return { kind: "cron", expression: schedule.expression };
  }
};
