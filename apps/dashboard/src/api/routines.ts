import type {
  Routine,
  RoutineInput,
  RoutinePatch,
  RoutineRun,
  RoutineSchedule,
  RoutinesResponse,
  SchedulePreview,
} from "@aop/common";
import { request } from "./request";

const routinesPath = (projectId: string, rest = ""): string =>
  `/projects/${encodeURIComponent(projectId)}/routines${rest}`;

const routinePath = (projectId: string, routineId: string, rest = ""): string =>
  routinesPath(projectId, `/${encodeURIComponent(routineId)}${rest}`);

/** The project's routines, oldest first, with the host's time zone and its caps. */
export const listRoutines = (projectId: string): Promise<RoutinesResponse> =>
  request<RoutinesResponse>(routinesPath(projectId));

export const createRoutine = async (projectId: string, input: RoutineInput): Promise<Routine> =>
  (
    await request<{ routine: Routine }>(routinesPath(projectId), {
      method: "POST",
      body: JSON.stringify(input),
    })
  ).routine;

export const updateRoutine = async (
  projectId: string,
  routineId: string,
  patch: RoutinePatch,
): Promise<Routine> =>
  (
    await request<{ routine: Routine }>(routinePath(projectId, routineId), {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  ).routine;

export const deleteRoutine = async (projectId: string, routineId: string): Promise<void> => {
  await request<unknown>(routinePath(projectId, routineId), { method: "DELETE" });
};

/** Starts a run now, outside the schedule. */
export const runRoutineNow = (
  projectId: string,
  routineId: string,
): Promise<{ routine: Routine; run: RoutineRun }> =>
  request(routinePath(projectId, routineId, "/run"), { method: "POST" });

/** Newest first. */
export const listRoutineRuns = async (
  projectId: string,
  routineId: string,
): Promise<RoutineRun[]> =>
  (await request<{ runs: RoutineRun[] }>(routinePath(projectId, routineId, "/runs"))).runs;

/** The schedule in words and its next runs on the host's clock, and why the host would refuse it. */
export const previewSchedule = (
  projectId: string,
  schedule: RoutineSchedule,
): Promise<SchedulePreview> =>
  request(routinesPath(projectId, "/preview"), {
    method: "POST",
    body: JSON.stringify({ schedule }),
  });
