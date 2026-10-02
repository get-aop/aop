import type {
  ReasoningEffort,
  RoutineCatchUp,
  RoutineRunTrigger,
  RoutineTarget,
} from "@aop/common";
import type { Generated, Selectable } from "kysely";

/** Added by migration v22 (routines-v22.ts). */
export interface RoutinesTable {
  id: string;
  project_id: string;
  name: string;
  prompt: string;
  /** JSON `RoutineSchedule`. */
  schedule_json: string;
  target: RoutineTarget;
  repo_id: string | null;
  model: string | null;
  effort: ReasoningEffort | null;
  /** SQLite has no boolean: 0 or 1. */
  enabled: Generated<0 | 1>;
  catch_up: Generated<RoutineCatchUp>;
  created_by: "person" | "coordinator";
  next_run_at: string | null;
  deferred_occurrence: Generated<string | null>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

/** A run that has not made its thread or message yet is `starting`; see routines-v22.ts. */
export type RoutineRunState = "starting" | "started" | "failed" | "skipped" | "missed" | "deferred";

export interface RoutineRunsTable {
  id: string;
  routine_id: string;
  occurrence_key: string;
  occurrence: string;
  trigger: RoutineRunTrigger;
  state: RoutineRunState;
  reason: string | null;
  thread_id: string | null;
  message_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RoutinesDatabase {
  routines: RoutinesTable;
  routine_runs: RoutineRunsTable;
}

export type RoutineRow = Selectable<RoutinesTable>;
export type RoutineRunRow = Selectable<RoutineRunsTable>;
