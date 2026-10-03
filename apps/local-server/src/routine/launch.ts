import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { RoutineRow } from "../db/routines-schema.ts";
import { describeServiceError } from "../project/errors.ts";
import type { ProjectServices } from "../project/services.ts";
import { recordRoutineUpserted } from "./events.ts";
import { createRoutineRepository } from "./repository.ts";

const logger = getLogger("routine");

/** What a run calls to start its work: a thread, or a message to the coordinator. */
export type RoutineLaunchServices = Pick<ProjectServices, "threads" | "projects">;

/**
 * Starts the work of a run the scheduler (or "Run now") has claimed: the run is `starting` and
 * its occurrence can fire nowhere else. A thread is linked in the transaction that stores it,
 * so a host that stops halfway leaves either a linked run or a `starting` one (failed at boot),
 * never a thread that two runs could make.
 */
export const launchRun = async (
  ctx: LocalServerContext,
  services: RoutineLaunchServices,
  routine: RoutineRow,
  run: { id: string; occurrence: string },
  now: () => Date,
): Promise<void> => {
  const failed = (reason: string) =>
    settleRun(ctx, routine.id, run.id, { state: "failed", reason }, now);
  try {
    if (routine.target === "thread") {
      const spawned = await services.threads.spawn(routine.project_id, {
        title: `${routine.name} · ${shortDate(run.occurrence)}`,
        prompt: threadBrief(routine, run.occurrence),
        routine: { id: routine.id, name: routine.name, prompt: routine.prompt },
        repoId: routine.repo_id,
        model: routine.model,
        effort: routine.effort,
        inTransaction: async (tx, threadId) => {
          await createRoutineRepository(tx.db).updateRun(
            run.id,
            { state: "started", threadId },
            now().toISOString(),
          );
          await recordRoutineUpserted(tx, routine.id);
        },
      });
      if (!spawned.success) await failed(describeServiceError(spawned.error));
      return;
    }
    const sent = await services.projects.sendToCoordinator(
      routine.project_id,
      coordinatorText(routine, run.occurrence),
      {
        origin: {
          type: "routine",
          routineId: routine.id,
          name: routine.name,
          prompt: routine.prompt,
        },
        // Its own turn, after any the coordinator is in: a routine never steers a reply mid-way.
        midRunMode: "queue",
      },
    );
    if (!sent.success) {
      await failed(describeServiceError(sent.error));
      return;
    }
    await settleRun(ctx, routine.id, run.id, { state: "started", messageId: sent.message.id }, now);
  } catch (error) {
    logger.error("Routine {routineId} could not start its run: {error}", {
      routineId: routine.id,
      error: String(error),
    });
    await failed(error instanceof Error ? error.message : String(error));
  }
};

const settleRun = async (
  ctx: LocalServerContext,
  routineId: string,
  runId: string,
  patch: Parameters<ReturnType<typeof createRoutineRepository>["updateRun"]>[1],
  now: () => Date,
): Promise<void> => {
  await ctx.eventPublisher.transaction(async (tx) => {
    await createRoutineRepository(tx.db).updateRun(runId, patch, now().toISOString());
    await recordRoutineUpserted(tx, routineId);
  });
};

// The run cannot see earlier runs or the chat: the brief says what it is and when, then the ask.
const threadBrief = (routine: RoutineRow, occurrence: string): string =>
  `This thread was started by the routine "${routine.name}" for its run of ${longDate(occurrence)}.\n\n${routine.prompt}`;

const coordinatorText = (routine: RoutineRow, occurrence: string): string =>
  `[Routine "${routine.name}", run of ${longDate(occurrence)}. The person set this up to arrive on a schedule; act on it as their request.]\n\n${routine.prompt}`;

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const longDate = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
