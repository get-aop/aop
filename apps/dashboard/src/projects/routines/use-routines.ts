import type { Routine, RoutineLimits } from "@aop/common";
import { useCallback, useEffect, useState } from "react";
import { listRoutines } from "../../api/routines";
import type { ProjectStreamEvent } from "../live-projects";
import { useLiveProjects } from "../ProjectsProvider";

// A run's status follows the thread or chat turn it started, which has no routine event of its
// own: the list is read again shortly after a thread or message changes.
const REFRESH_AFTER_ACTIVITY_MS = 800;

export interface RoutinesState {
  /** Null until the first load. */
  routines: readonly Routine[] | null;
  timeZone: string | null;
  limits: RoutineLimits | null;
  error: string | null;
  reload: () => Promise<void>;
  /** Puts a routine the host just answered with in place, ahead of its stream entry. */
  put: (routine: Routine) => void;
  drop: (routineId: string) => void;
}

/** A project's routines, kept current from its event stream. */
export const useRoutines = (projectId: string): RoutinesState => {
  const live = useLiveProjects();
  const [routines, setRoutines] = useState<readonly Routine[] | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [limits, setLimits] = useState<RoutineLimits | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const listed = await listRoutines(projectId);
      setRoutines(listed.routines);
      setTimeZone(listed.timeZone);
      setLimits(listed.limits);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [projectId]);

  const put = useCallback((routine: Routine) => {
    setRoutines((current) => upsert(current ?? [], routine));
  }, []);

  const drop = useCallback((routineId: string) => {
    setRoutines((current) => (current ?? []).filter((routine) => routine.id !== routineId));
  }, []);

  useEffect(() => {
    void reload();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reloadSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), REFRESH_AFTER_ACTIVITY_MS);
    };
    const unsubscribe = live.subscribeEvents(projectId, (event) => {
      const step = readEvent(event);
      switch (step.kind) {
        case "put":
          return put(step.routine);
        case "drop":
          return drop(step.routineId);
        case "reload":
          return void reload();
        case "reload-soon":
          return reloadSoon();
      }
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [live, projectId, reload, put, drop]);

  return { routines, timeZone, limits, error, reload, put, drop };
};

type EventStep =
  | { kind: "put"; routine: Routine }
  | { kind: "drop"; routineId: string }
  | { kind: "reload" | "reload-soon" | "none" };

/** What a stream event means for the list. */
export const readEvent = (event: ProjectStreamEvent): EventStep => {
  if (event.kind === "resync") return { kind: "reload" };
  if (event.kind !== "entry") return { kind: "none" };
  const { entry } = event;
  switch (entry.type) {
    case "routine.upserted":
      return { kind: "put", routine: entry.payload.routine };
    case "routine.removed":
      return { kind: "drop", routineId: entry.payload.routineId };
    case "thread.upserted":
    case "message.created":
      return { kind: "reload-soon" };
    default:
      return { kind: "none" };
  }
};

/** Replaces the routine with that id, or adds it at the end; the list stays oldest first. */
export const upsert = (routines: readonly Routine[], routine: Routine): Routine[] => {
  const index = routines.findIndex((known) => known.id === routine.id);
  return index === -1
    ? [...routines, routine]
    : routines.map((known, at) => (at === index ? routine : known));
};
