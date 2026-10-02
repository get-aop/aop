import type { RoutineRunTrigger } from "@aop/common";
import { type Kysely, sql, type Updateable } from "kysely";
import type {
  RoutineRow,
  RoutineRunRow,
  RoutineRunState,
  RoutinesTable,
} from "../db/routines-schema.ts";
import type { Database } from "../db/schema.ts";

/** Data access for routines and their runs; the rules are in service.ts and scheduler.ts. */

export type NewRoutineRow = Omit<RoutineRow, "created_at" | "updated_at" | "deferred_occurrence">;

export type RoutineColumns = Omit<
  Updateable<RoutinesTable>,
  "id" | "project_id" | "created_at" | "updated_at"
>;

export interface NewRoutineRun {
  id: string;
  routineId: string;
  occurrenceKey: string;
  occurrence: string;
  trigger: RoutineRunTrigger;
  state: RoutineRunState;
  reason?: string | null;
}

export interface RoutineRunPatch {
  state?: RoutineRunState;
  trigger?: RoutineRunTrigger;
  reason?: string | null;
  threadId?: string | null;
  messageId?: string | null;
}

/** A due routine with what the scheduler needs of its project. */
export interface DueRoutine {
  routine: RoutineRow;
  projectStatus: string;
  autoContinue: boolean;
}

export interface RoutineRepository {
  insert: (row: NewRoutineRow, at: string) => Promise<void>;
  getById: (id: string) => Promise<RoutineRow | null>;
  /** Oldest first. */
  listByProject: (projectId: string) => Promise<RoutineRow[]>;
  update: (id: string, columns: RoutineColumns, at: string) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  /**
   * Moves a routine's next run on from `from`, only if nothing did meanwhile: true when this call
   * did. It is the claim on the occurrence at `from`, so of two passes (or two hosts) that saw
   * it due, one acts on it.
   */
  advance: (
    id: string,
    from: string,
    to: { nextRunAt: string | null; deferredOccurrence: string | null },
    at: string,
  ) => Promise<boolean>;
  /** The run of an occurrence, by its key. */
  getRunByKey: (routineId: string, occurrenceKey: string) => Promise<RoutineRunRow | null>;
  countEnabled: (projectId: string, exceptId?: string) => Promise<number>;
  /** Enabled routines whose next run is at or before `at`, in projects that are not archived. */
  listDue: (at: string) => Promise<DueRoutine[]>;
  /** The soonest next run of an enabled routine in a project that is not archived. */
  earliestNextRun: () => Promise<string | null>;
  /**
   * Inserts a run unless its routine already has one for the occurrence: true when this call
   * made it. The unique (routine, occurrence key) is what makes an occurrence fire once.
   */
  insertRun: (run: NewRoutineRun, at: string) => Promise<boolean>;
  updateRun: (id: string, patch: RoutineRunPatch, at: string) => Promise<void>;
  getRun: (id: string) => Promise<RoutineRunRow | null>;
  /** Newest first. */
  listRuns: (routineId: string, limit: number) => Promise<RoutineRunRow[]>;
  /** The newest run of each routine named. */
  latestRuns: (routineIds: readonly string[]) => Promise<Map<string, RoutineRunRow>>;
  /** The newest run that started something (or is starting it), for the overlap rule. */
  latestStarted: (routineId: string) => Promise<RoutineRunRow | null>;
  /** Runs left `starting` by a host that stopped: failed, with `reason`. Returns their routines. */
  failStarting: (reason: string, at: string) => Promise<string[]>;
  /** Keeps the newest `keep` runs of a routine. */
  pruneRuns: (routineId: string, keep: number) => Promise<void>;
}

export const createRoutineRepository = (db: Kysely<Database>): RoutineRepository => ({
  insert: async (row, at) => {
    await db
      .insertInto("routines")
      .values({ ...row, created_at: at, updated_at: at })
      .execute();
  },

  getById: async (id) =>
    (await db.selectFrom("routines").selectAll().where("id", "=", id).executeTakeFirst()) ?? null,

  listByProject: (projectId) =>
    db
      .selectFrom("routines")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("created_at")
      .orderBy("id")
      .execute(),

  update: async (id, columns, at) => {
    await db
      .updateTable("routines")
      .set({ ...columns, updated_at: at })
      .where("id", "=", id)
      .execute();
  },

  remove: async (id) => {
    const result = await db.deleteFrom("routines").where("id", "=", id).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  },

  advance: async (id, from, to, at) => {
    const result = await db
      .updateTable("routines")
      .set({
        next_run_at: to.nextRunAt,
        deferred_occurrence: to.deferredOccurrence,
        updated_at: at,
      })
      .where("id", "=", id)
      .where("next_run_at", "=", from)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  },

  getRunByKey: async (routineId, occurrenceKey) =>
    (await db
      .selectFrom("routine_runs")
      .selectAll()
      .where("routine_id", "=", routineId)
      .where("occurrence_key", "=", occurrenceKey)
      .executeTakeFirst()) ?? null,

  countEnabled: async (projectId, exceptId) => {
    let query = db
      .selectFrom("routines")
      .select(sql<number>`COUNT(*)`.as("count"))
      .where("project_id", "=", projectId)
      .where("enabled", "=", 1);
    if (exceptId) query = query.where("id", "!=", exceptId);
    return Number((await query.executeTakeFirstOrThrow()).count);
  },

  listDue: async (at) => {
    const rows = await db
      .selectFrom("routines")
      .innerJoin("projects", "projects.id", "routines.project_id")
      .selectAll("routines")
      .select(["projects.status as project_status", "projects.auto_continue as auto_continue"])
      .where("routines.enabled", "=", 1)
      .where("routines.next_run_at", "is not", null)
      .where("routines.next_run_at", "<=", at)
      .where("projects.status", "!=", "archived")
      .orderBy("routines.next_run_at")
      .execute();
    return rows.map(({ project_status, auto_continue, ...routine }) => ({
      routine,
      projectStatus: project_status,
      autoContinue: auto_continue === 1,
    }));
  },

  earliestNextRun: async () => {
    const row = await db
      .selectFrom("routines")
      .innerJoin("projects", "projects.id", "routines.project_id")
      .select(sql<string | null>`MIN(routines.next_run_at)`.as("next"))
      .where("routines.enabled", "=", 1)
      .where("projects.status", "!=", "archived")
      .executeTakeFirst();
    return row?.next ?? null;
  },

  insertRun: async (run, at) => {
    const result = await db
      .insertInto("routine_runs")
      .values({
        id: run.id,
        routine_id: run.routineId,
        occurrence_key: run.occurrenceKey,
        occurrence: run.occurrence,
        trigger: run.trigger,
        state: run.state,
        reason: run.reason ?? null,
        thread_id: null,
        message_id: null,
        created_at: at,
        updated_at: at,
      })
      .onConflict((conflict) => conflict.columns(["routine_id", "occurrence_key"]).doNothing())
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
  },

  updateRun: async (id, patch, at) => {
    await db
      .updateTable("routine_runs")
      .set({
        ...(patch.state !== undefined && { state: patch.state }),
        ...(patch.trigger !== undefined && { trigger: patch.trigger }),
        ...(patch.reason !== undefined && { reason: patch.reason }),
        ...(patch.threadId !== undefined && { thread_id: patch.threadId }),
        ...(patch.messageId !== undefined && { message_id: patch.messageId }),
        updated_at: at,
      })
      .where("id", "=", id)
      .execute();
  },

  getRun: async (id) =>
    (await db.selectFrom("routine_runs").selectAll().where("id", "=", id).executeTakeFirst()) ??
    null,

  listRuns: (routineId, limit) =>
    db
      .selectFrom("routine_runs")
      .selectAll()
      .where("routine_id", "=", routineId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit)
      .execute(),

  latestRuns: async (routineIds) => {
    if (routineIds.length === 0) return new Map();
    const rows = await db
      .selectFrom("routine_runs as run")
      .selectAll("run")
      .where("run.routine_id", "in", [...routineIds])
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("routine_runs as newer")
              .select("newer.id")
              .whereRef("newer.routine_id", "=", "run.routine_id")
              .where((eb) =>
                eb.or([
                  eb("newer.created_at", ">", eb.ref("run.created_at")),
                  eb.and([
                    eb("newer.created_at", "=", eb.ref("run.created_at")),
                    eb("newer.id", ">", eb.ref("run.id")),
                  ]),
                ]),
              ),
          ),
        ),
      )
      .execute();
    return new Map(rows.map((row) => [row.routine_id, row]));
  },

  latestStarted: async (routineId) =>
    (await db
      .selectFrom("routine_runs")
      .selectAll()
      .where("routine_id", "=", routineId)
      .where("state", "in", ["starting", "started"])
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst()) ?? null,

  failStarting: async (reason, at) => {
    const rows = await db
      .updateTable("routine_runs")
      .set({ state: "failed", reason, updated_at: at })
      .where("state", "=", "starting")
      .returning("routine_id")
      .execute();
    return [...new Set(rows.map((row) => row.routine_id))];
  },

  pruneRuns: async (routineId, keep) => {
    await db
      .deleteFrom("routine_runs")
      .where("routine_id", "=", routineId)
      .where(
        "id",
        "not in",
        db
          .selectFrom("routine_runs")
          .select("id")
          .where("routine_id", "=", routineId)
          .orderBy("created_at", "desc")
          .orderBy("id", "desc")
          .limit(keep),
      )
      .execute();
  },
});
