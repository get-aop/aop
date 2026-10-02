import {
  nextOccurrence,
  ROUTINE_HISTORY_MAX,
  type RoutineRunTrigger,
  RoutineScheduleSchema,
} from "@aop/common";
import { generateTypeId, getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { RoutineRow, RoutineRunRow, RoutineRunState } from "../db/routines-schema.ts";
import { recordRoutineUpserted } from "./events.ts";
import { launchRun, type RoutineLaunchServices } from "./launch.ts";
import { createRoutineRepository, type DueRoutine } from "./repository.ts";
import type { UsageLimitCheck } from "./usage-limit.ts";
import { isRunActive } from "./wire.ts";

const logger = getLogger("routine");

/** An occurrence this late was missed (the host was off or asleep), not merely reached late. */
export const MISSED_AFTER_MS = 2 * 60_000;
const MISSED_COUNT_CAP = 1000;

export interface RoutineClock {
  now: () => Date;
  /** The host's time zone: every schedule is read on its clock. */
  timeZone: () => string;
}

export interface RoutineRunner {
  /** One pass over the routines that are due: each occurrence fires, or is recorded as not. */
  processDue: () => Promise<void>;
  /** "Run now": a run outside the schedule, started at once. */
  runNow: (routine: RoutineRow) => Promise<RoutineRunRow>;
  /** Whether the routine's last run is still working, so another must wait. */
  isBusy: (routineId: string) => Promise<boolean>;
  /** At boot: runs a stopped host left `starting` never started their work. */
  recover: () => Promise<void>;
  /** The next occurrence after now, as stored, or null when the schedule never comes again. */
  nextRunAfterNow: (routine: Pick<RoutineRow, "schedule_json">) => string | null;
}

type Decision =
  | { kind: "fire"; trigger: RoutineRunTrigger; reason: string | null }
  | { kind: "record"; state: "missed" | "skipped"; reason: string }
  | { kind: "defer"; until: string; reason: string };

export const createRoutineRunner = (
  ctx: LocalServerContext,
  services: RoutineLaunchServices,
  clock: RoutineClock,
  usageLimit: UsageLimitCheck,
): RoutineRunner => {
  const repo = createRoutineRepository(ctx.db);

  const nextRunAfterNow: RoutineRunner["nextRunAfterNow"] = (routine) => {
    const schedule = RoutineScheduleSchema.parse(JSON.parse(routine.schedule_json));
    const next = nextOccurrence(schedule, clock.now().getTime(), clock.timeZone());
    return next === null ? null : new Date(next).toISOString();
  };

  const isBusy = async (routineId: string): Promise<boolean> => {
    const latest = await repo.latestStarted(routineId);
    return latest !== null && (await isRunActive(ctx.db, latest));
  };

  // Why an occurrence cannot start now, whatever the plan's limit says.
  const blockedReason = async (due: DueRoutine): Promise<string | null> => {
    if (due.projectStatus === "paused") return "The project is paused";
    if (await isBusy(due.routine.id)) return "The previous run is still working";
    return null;
  };

  const decide = async (due: DueRoutine, now: Date): Promise<Decision> => {
    const { routine } = due;
    const missed = missedCount(routine, now, clock.timeZone());
    if (missed > 0 && routine.catch_up === "skip") {
      return { kind: "record", state: "missed", reason: missedReason(missed) };
    }
    const blocked = await blockedReason(due);
    if (blocked) return { kind: "record", state: "skipped", reason: blocked };
    const until = await usageLimit(routine, now);
    if (until) return limited(until, due.autoContinue);
    return missed > 0
      ? { kind: "fire", trigger: "catch-up", reason: `Ran once on start: ${missedReason(missed)}` }
      : { kind: "fire", trigger: "schedule", reason: null };
  };

  const processOne = async (due: DueRoutine): Promise<void> => {
    const now = clock.now();
    const decision = await decide(due, now);
    const { routine } = due;
    const occurrence = routine.next_run_at as string;
    const key = routine.deferred_occurrence ?? occurrence;
    const at = now.toISOString();

    const claimed = await ctx.eventPublisher.transaction(async (tx) => {
      const routines = createRoutineRepository(tx.db);
      const moved = await routines.advance(
        routine.id,
        occurrence,
        decision.kind === "defer"
          ? { nextRunAt: decision.until, deferredOccurrence: key }
          : { nextRunAt: nextRunAfterNow(routine), deferredOccurrence: null },
        at,
      );
      // Another pass or another host acted on this occurrence first.
      if (!moved) return null;
      const run = await keepRun(routines, routine, key, decision, at);
      await routines.pruneRuns(routine.id, ROUTINE_HISTORY_MAX);
      await recordRoutineUpserted(tx, routine.id);
      return decision.kind === "fire" ? run : null;
    });
    if (claimed) await launchRun(ctx, services, routine, claimed, clock.now);
  };

  return {
    processDue: async () => {
      for (const due of await repo.listDue(clock.now().toISOString())) {
        try {
          await processOne(due);
        } catch (error) {
          logger.error("Routine {routineId} could not run: {error}", {
            routineId: due.routine.id,
            error: String(error),
          });
        }
      }
    },

    runNow: async (routine) => {
      const now = clock.now().toISOString();
      const id = generateTypeId("rrun");
      await ctx.eventPublisher.transaction(async (tx) => {
        const routines = createRoutineRepository(tx.db);
        await routines.insertRun(
          {
            id,
            routineId: routine.id,
            occurrenceKey: `manual:${id}`,
            occurrence: now,
            trigger: "manual",
            state: "starting",
          },
          now,
        );
        await routines.pruneRuns(routine.id, ROUTINE_HISTORY_MAX);
        await recordRoutineUpserted(tx, routine.id);
      });
      await launchRun(ctx, services, routine, { id, occurrence: now }, clock.now);
      return (await repo.getRun(id)) as RoutineRunRow;
    },

    isBusy,

    recover: async () => {
      const at = clock.now().toISOString();
      await ctx.eventPublisher.transaction(async (tx) => {
        const routines = createRoutineRepository(tx.db);
        const touched = await routines.failStarting(
          "The host stopped before this run started its work",
          at,
        );
        for (const routineId of touched) await recordRoutineUpserted(tx, routineId);
      });
    },

    nextRunAfterNow,
  };
};

/**
 * The run row an occurrence ends with. A deferred occurrence already has one: it is reused,
 * so its history shows one run that waited and then ran.
 */
const keepRun = async (
  routines: ReturnType<typeof createRoutineRepository>,
  routine: RoutineRow,
  key: string,
  decision: Decision,
  at: string,
): Promise<{ id: string; occurrence: string }> => {
  const state: RoutineRunState =
    decision.kind === "fire" ? "starting" : decision.kind === "defer" ? "deferred" : decision.state;
  const trigger = decision.kind === "fire" ? decision.trigger : "schedule";
  const existing = await routines.getRunByKey(routine.id, key);
  if (existing) {
    await routines.updateRun(existing.id, { state, trigger, reason: decision.reason }, at);
    return { id: existing.id, occurrence: existing.occurrence };
  }
  const id = generateTypeId("rrun");
  await routines.insertRun(
    {
      id,
      routineId: routine.id,
      occurrenceKey: key,
      occurrence: key,
      trigger,
      state,
      reason: decision.reason,
    },
    at,
  );
  return { id, occurrence: key };
};

const limited = (until: string, autoContinue: boolean): Decision =>
  autoContinue
    ? {
        kind: "defer",
        until,
        reason: "The Claude usage limit is reached; it runs when the limit resets",
      }
    : {
        kind: "record",
        state: "skipped",
        reason: "The Claude usage limit is reached and auto-continue is off",
      };

// How many occurrences passed unrun, counting the one due; 0 when it is on time (or deferred,
// which is late on purpose).
const missedCount = (routine: RoutineRow, now: Date, timeZone: string): number => {
  const due = Date.parse(routine.next_run_at as string);
  if (routine.deferred_occurrence || now.getTime() - due <= MISSED_AFTER_MS) return 0;
  const schedule = RoutineScheduleSchema.parse(JSON.parse(routine.schedule_json));
  let count = 1;
  let cursor = nextOccurrence(schedule, due, timeZone);
  while (cursor !== null && cursor <= now.getTime() && count < MISSED_COUNT_CAP) {
    count += 1;
    cursor = nextOccurrence(schedule, cursor, timeZone);
  }
  return count;
};

const missedReason = (count: number): string =>
  count === 1
    ? "Missed while the host was off"
    : `Missed ${count >= MISSED_COUNT_CAP ? `${MISSED_COUNT_CAP}+` : count} runs while the host was off`;
