import {
  DEFAULT_ROUTINE_MAX_ACTIVE,
  DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES,
  describeSchedule,
  nextOccurrences,
  type ParsedRoutineInput,
  type Project,
  parseRoutineMaxActive,
  parseRoutineMinInterval,
  ROUTINE_HISTORY_MAX,
  type Routine,
  type RoutineLimits,
  type RoutinePatch,
  type RoutineRun,
  type RoutineSchedule,
  type RoutinesResponse,
  type SchedulePreview,
  shortestGapMinutes,
} from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { RoutineRow } from "../db/routines-schema.ts";
import type { ChatEngine } from "../project/engine.ts";
import { SettingKey } from "../settings/types.ts";
import { recordRoutineRemoved, recordRoutineUpserted } from "./events.ts";
import { type RoutineProposal, sendRoutineProposal } from "./proposal.ts";
import { createRoutineRepository, type RoutineColumns } from "./repository.ts";
import type { RoutineClock, RoutineRunner } from "./runner.ts";
import type { RoutineError, RoutineResult } from "./types.ts";
import { toRoutine, toRuns } from "./wire.ts";

const PREVIEW_RUNS = 3;

export interface RoutineService {
  list: (projectId: string) => Promise<RoutineResult<RoutinesResponse>>;
  get: (projectId: string, routineId: string) => Promise<RoutineResult<{ routine: Routine }>>;
  create: (
    projectId: string,
    input: ParsedRoutineInput,
    createdBy: Routine["createdBy"],
  ) => Promise<RoutineResult<{ routine: Routine }>>;
  update: (
    projectId: string,
    routineId: string,
    patch: RoutinePatch,
  ) => Promise<RoutineResult<{ routine: Routine }>>;
  remove: (projectId: string, routineId: string) => Promise<RoutineResult<Record<never, never>>>;
  /** Starts a run now, outside the schedule. Refused while the last run still works. */
  runNow: (
    projectId: string,
    routineId: string,
  ) => Promise<RoutineResult<{ routine: Routine; run: RoutineRun }>>;
  /** Newest first. */
  runs: (projectId: string, routineId: string) => Promise<RoutineResult<{ runs: RoutineRun[] }>>;
  /** A thread's proposal for the coordinator to put to the person; refused if the host would refuse it. */
  propose: (
    projectId: string,
    thread: { id: string; title: string },
    proposal: Omit<RoutineProposal, "when">,
  ) => Promise<RoutineResult<Record<never, never>>>;
  /** A schedule in words with its next runs on the host's clock, and why it would be refused. */
  preview: (schedule: RoutineSchedule) => Promise<SchedulePreview>;
}

/**
 * The rules around routines: the caps, the repository a thread works in, when the next run is.
 * `onChange` tells the scheduler to look again (scheduler.ts).
 */
export const createRoutineService = (
  ctx: LocalServerContext,
  runner: RoutineRunner,
  chat: ChatEngine,
  clock: RoutineClock,
  onChange: () => void,
): RoutineService => {
  const repo = createRoutineRepository(ctx.db);

  const limits = async (): Promise<RoutineLimits> => ({
    minIntervalMinutes:
      parseRoutineMinInterval(await ctx.settingsRepository.get(SettingKey.ROUTINE_MIN_INTERVAL)) ??
      DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES,
    maxActive:
      parseRoutineMaxActive(await ctx.settingsRepository.get(SettingKey.ROUTINE_MAX_ACTIVE)) ??
      DEFAULT_ROUTINE_MAX_ACTIVE,
  });

  const read = async (row: RoutineRow): Promise<Routine> => {
    const latest = (await repo.latestRuns([row.id])).get(row.id);
    const [lastRun] = latest ? await toRuns(ctx.db, [latest]) : [];
    return toRoutine(row, lastRun ?? null);
  };

  const owned = async (
    projectId: string,
    routineId: string,
  ): Promise<{ row: RoutineRow } | { error: RoutineError }> => {
    const row = await repo.getById(routineId);
    return row && row.project_id === projectId ? { row } : { error: { code: "ROUTINE_NOT_FOUND" } };
  };

  const scheduleProblem = async (schedule: RoutineSchedule): Promise<RoutineError | null> => {
    const { minIntervalMinutes } = await limits();
    const gap = shortestGapMinutes(schedule);
    if (gap < minIntervalMinutes) {
      return { code: "ROUTINE_TOO_FREQUENT", gapMinutes: gap, minIntervalMinutes };
    }
    return runner.nextRunAfterNow({ schedule_json: JSON.stringify(schedule) }) === null
      ? { code: "INVALID_ROUTINE", message: "This schedule never runs" }
      : null;
  };

  const enabledCapProblem = async (
    projectId: string,
    exceptId?: string,
  ): Promise<RoutineError | null> => {
    const { maxActive } = await limits();
    return (await repo.countEnabled(projectId, exceptId)) >= maxActive
      ? { code: "ROUTINE_LIMIT", maxActive }
      : null;
  };

  // A thread needs a repository it can work in; a message to the coordinator carries none.
  const targetFields = (
    project: Project,
    fields: Pick<RoutineRow, "target"> & TargetFields,
  ): TargetFields | { error: RoutineError } => {
    if (fields.target === "coordinator") return { repo_id: null, model: null, effort: null };
    if (fields.repo_id && !project.repoIds.includes(fields.repo_id)) {
      return {
        error: {
          code: "REPO_NOT_IN_PROJECT",
          repoId: fields.repo_id,
          repoIds: [...project.repoIds],
        },
      };
    }
    if (!fields.repo_id && project.repoIds.length > 1) {
      return { error: { code: "REPO_REQUIRED", repoIds: [...project.repoIds] } };
    }
    return { repo_id: fields.repo_id, model: fields.model, effort: fields.effort };
  };

  const updateProblem = async (
    projectId: string,
    row: RoutineRow,
    patch: RoutinePatch,
  ): Promise<RoutineError | null> => {
    if (patch.schedule) {
      const problem = await scheduleProblem(patch.schedule);
      if (problem) return problem;
    }
    const turningOn = patch.enabled === true && row.enabled === 0;
    return turningOn ? enabledCapProblem(projectId, row.id) : null;
  };

  const changed = async (row: RoutineRow): Promise<RoutineResult<{ routine: Routine }>> => {
    onChange();
    return { success: true, routine: await read(row) };
  };

  return {
    list: async (projectId) => {
      if (!(await ctx.projectRepository.getById(projectId))) {
        return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      }
      const rows = await repo.listByProject(projectId);
      const latest = await repo.latestRuns(rows.map((row) => row.id));
      const lastRuns = await toRuns(ctx.db, [...latest.values()]);
      const byRoutine = new Map(lastRuns.map((run) => [run.routineId, run]));
      return {
        success: true,
        routines: rows.map((row) => toRoutine(row, byRoutine.get(row.id) ?? null)),
        timeZone: clock.timeZone(),
        limits: await limits(),
      };
    },

    get: async (projectId, routineId) => {
      const found = await owned(projectId, routineId);
      if ("error" in found) return { success: false, error: found.error };
      return { success: true, routine: await read(found.row) };
    },

    create: async (projectId, input, createdBy) => {
      const project = await ctx.projectRepository.getById(projectId);
      if (!project) return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      const problem =
        (await scheduleProblem(input.schedule)) ??
        (input.enabled ? await enabledCapProblem(projectId) : null);
      if (problem) return { success: false, error: problem };
      const target = targetFields(project, {
        target: input.target,
        repo_id: input.repoId,
        model: input.model,
        effort: input.effort,
      });
      if ("error" in target) return { success: false, error: target.error };

      const id = generateTypeId("rtn");
      const scheduleJson = JSON.stringify(input.schedule);
      const at = clock.now().toISOString();
      await ctx.eventPublisher.transaction(async (tx) => {
        await createRoutineRepository(tx.db).insert(
          {
            id,
            project_id: projectId,
            name: input.name,
            prompt: input.prompt,
            schedule_json: scheduleJson,
            target: input.target,
            ...target,
            enabled: input.enabled ? 1 : 0,
            catch_up: input.catchUp,
            created_by: createdBy,
            next_run_at: input.enabled
              ? runner.nextRunAfterNow({ schedule_json: scheduleJson })
              : null,
          },
          at,
        );
        await recordRoutineUpserted(tx, id);
      });
      return changed((await repo.getById(id)) as RoutineRow);
    },

    update: async (projectId, routineId, patch) => {
      const found = await owned(projectId, routineId);
      if ("error" in found) return { success: false, error: found.error };
      const project = await ctx.projectRepository.getById(projectId);
      if (!project) return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      const { row } = found;
      const problem = await updateProblem(projectId, row, patch);
      if (problem) return { success: false, error: problem };
      const target = targetFields(project, mergedTarget(row, patch));
      if ("error" in target) return { success: false, error: target.error };

      const columns = patchColumns(row, patch, target, runner.nextRunAfterNow);
      await ctx.eventPublisher.transaction(async (tx) => {
        await createRoutineRepository(tx.db).update(routineId, columns, clock.now().toISOString());
        await recordRoutineUpserted(tx, routineId);
      });
      return changed((await repo.getById(routineId)) as RoutineRow);
    },

    remove: async (projectId, routineId) => {
      const found = await owned(projectId, routineId);
      if ("error" in found) return { success: false, error: found.error };
      await ctx.eventPublisher.transaction(async (tx) => {
        await createRoutineRepository(tx.db).remove(routineId);
        await recordRoutineRemoved(tx, projectId, routineId);
      });
      onChange();
      return { success: true };
    },

    runNow: async (projectId, routineId) => {
      const found = await owned(projectId, routineId);
      if ("error" in found) return { success: false, error: found.error };
      const project = await ctx.projectRepository.getById(projectId);
      if (project && project.status !== "active") {
        return { success: false, error: { code: "PROJECT_NOT_ACTIVE", status: project.status } };
      }
      if (await runner.isBusy(routineId))
        return { success: false, error: { code: "ROUTINE_BUSY" } };
      const started = await runner.runNow(found.row);
      const [run] = await toRuns(ctx.db, [started]);
      return {
        success: true,
        run: run as RoutineRun,
        routine: await read((await repo.getById(routineId)) as RoutineRow),
      };
    },

    runs: async (projectId, routineId) => {
      const found = await owned(projectId, routineId);
      if ("error" in found) return { success: false, error: found.error };
      return {
        success: true,
        runs: await toRuns(ctx.db, await repo.listRuns(routineId, ROUTINE_HISTORY_MAX)),
      };
    },

    propose: async (projectId, thread, proposal) => {
      const problem = await scheduleProblem(proposal.routine.schedule);
      if (problem) return { success: false, error: problem };
      return sendRoutineProposal(ctx, chat, projectId, thread, {
        ...proposal,
        when: describeSchedule(proposal.routine.schedule),
      });
    },

    preview: async (schedule) => {
      const timeZone = clock.timeZone();
      const problem = await scheduleProblem(schedule);
      return {
        description: describeSchedule(schedule),
        nextRuns: nextOccurrences(schedule, clock.now().getTime(), timeZone, PREVIEW_RUNS).map(
          (instant) => new Date(instant).toISOString(),
        ),
        timeZone,
        problem: problem ? describeRoutineError(problem) : null,
      };
    },
  };
};

const everyMinutes = (minutes: number): string =>
  minutes === 1 ? "every minute" : `every ${minutes} minutes`;

type TargetFields = Pick<RoutineRow, "repo_id" | "model" | "effort">;

/** The routine's target fields with the patch applied; a field the patch leaves out stays. */
const mergedTarget = (row: RoutineRow, patch: RoutinePatch) => ({
  target: patch.target ?? row.target,
  repo_id: patch.repoId === undefined ? row.repo_id : patch.repoId,
  model: patch.model === undefined ? row.model : patch.model,
  effort: patch.effort === undefined ? row.effort : patch.effort,
});

/**
 * The columns a patch writes. A new schedule, or a routine turned back on, counts from now:
 * a paused routine does not owe the runs it would have made.
 */
const patchColumns = (
  row: RoutineRow,
  patch: RoutinePatch,
  target: TargetFields,
  nextRunAfterNow: RoutineRunner["nextRunAfterNow"],
): RoutineColumns => {
  const scheduleJson = patch.schedule ? JSON.stringify(patch.schedule) : row.schedule_json;
  const enabled = patch.enabled ?? row.enabled === 1;
  const reschedule = patch.schedule !== undefined || patch.enabled !== undefined;
  return {
    name: patch.name ?? row.name,
    prompt: patch.prompt ?? row.prompt,
    target: patch.target ?? row.target,
    catch_up: patch.catchUp ?? row.catch_up,
    ...target,
    schedule_json: scheduleJson,
    enabled: enabled ? 1 : 0,
    ...(reschedule && {
      next_run_at: enabled ? nextRunAfterNow({ schedule_json: scheduleJson }) : null,
      deferred_occurrence: null,
    }),
  };
};

export const describeRoutineError = (error: RoutineError): string => {
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
      return "Project not found";
    case "ROUTINE_NOT_FOUND":
      return "Routine not found";
    case "ROUTINE_TOO_FREQUENT":
      return `This schedule runs ${everyMinutes(error.gapMinutes)} at its closest; routines run at most ${everyMinutes(error.minIntervalMinutes)} on this host (the host owner can change routine_min_interval_minutes)`;
    case "ROUTINE_LIMIT":
      return `This project already has ${error.maxActive} routines turned on, the most a project may have; pause or delete one first`;
    case "ROUTINE_BUSY":
      return "The routine's last run is still working; wait for it to finish";
    case "INVALID_ROUTINE":
      return error.message;
    case "REPO_REQUIRED":
      return `This project has several repositories; pick one of: ${error.repoIds.join(", ")}`;
    case "REPO_NOT_IN_PROJECT":
      return `Repository ${error.repoId} is not one of this project's repositories: ${error.repoIds.join(", ") || "(none)"}`;
    case "PROJECT_NOT_ACTIVE":
      return `The project is ${error.status}`;
  }
};
