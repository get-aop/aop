import {
  type Routine,
  type RoutineRun,
  type RoutineRunStatus,
  RoutineScheduleSchema,
  type ThreadStatus,
} from "@aop/common";
import type { Kysely } from "kysely";
import type { RoutineRow, RoutineRunRow } from "../db/routines-schema.ts";
import type { ChatRunStatus, Database } from "../db/schema.ts";

/*
 * Routines as the wire carries them. A started run's status is not stored: it is read from the
 * turn it started, so it is right however that turn ended (finished, failed, stopped, deleted)
 * without the chat engine knowing about routines.
 */

// A thread in one of these has not finished what the run asked: the next run waits for it.
const ACTIVE_THREAD: ReadonlySet<ThreadStatus> = new Set([
  "working",
  "queued",
  "rate-limited",
  "waiting-on-you",
  "landing",
]);

export const toRoutine = (row: RoutineRow, lastRun: RoutineRun | null): Routine => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  prompt: row.prompt,
  schedule: RoutineScheduleSchema.parse(JSON.parse(row.schedule_json)),
  target: row.target,
  repoId: row.repo_id,
  model: row.model,
  effort: row.effort,
  enabled: row.enabled === 1,
  catchUp: row.catch_up,
  nextRunAt: row.enabled === 1 ? row.next_run_at : null,
  lastRun,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Runs in the order given, each with its status read from what it started. */
export const toRuns = async (
  db: Kysely<Database>,
  rows: readonly RoutineRunRow[],
): Promise<RoutineRun[]> => {
  const outcomes = await readOutcomes(db, rows);
  return rows.map((row) => {
    const outcome = row.state === "started" ? outcomes.get(row.id) : undefined;
    return {
      id: row.id,
      routineId: row.routine_id,
      occurrence: row.occurrence,
      trigger: row.trigger,
      status: outcome?.status ?? storedStatus(row),
      reason: outcome?.reason ?? row.reason,
      threadId: row.thread_id,
      messageId: row.message_id,
      createdAt: row.created_at,
    };
  });
};

/** Whether a run still holds the routine: the next occurrence is skipped while it does. */
export const isRunActive = async (db: Kysely<Database>, row: RoutineRunRow): Promise<boolean> => {
  if (row.state === "starting") return true;
  const [run] = await toRuns(db, [row]);
  return run?.status === "running";
};

const storedStatus = (row: RoutineRunRow): RoutineRunStatus => {
  switch (row.state) {
    case "starting":
      return "running";
    case "started":
      return "ok";
    default:
      return row.state;
  }
};

interface Outcome {
  status: RoutineRunStatus;
  reason: string | null;
}

const readOutcomes = async (
  db: Kysely<Database>,
  rows: readonly RoutineRunRow[],
): Promise<Map<string, Outcome>> => {
  const started = rows.filter((row) => row.state === "started");
  const outcomes = new Map<string, Outcome>();
  for (const row of started) {
    const outcome = row.thread_id
      ? await threadOutcome(db, row.thread_id)
      : row.message_id
        ? await messageOutcome(db, row.message_id)
        : null;
    if (outcome) outcomes.set(row.id, outcome);
  }
  return outcomes;
};

const threadOutcome = async (db: Kysely<Database>, threadId: string): Promise<Outcome | null> => {
  const session = await db
    .selectFrom("chat_sessions")
    .select("state")
    .where("id", "=", threadId)
    .executeTakeFirst();
  if (!session) return null;
  if (session.state && ACTIVE_THREAD.has(session.state)) return { status: "running", reason: null };
  const run = await db
    .selectFrom("chat_runs")
    .select(["status", "error_message"])
    .where("session_id", "=", threadId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  return run ? endedRun(run.status, run.error_message) : { status: "ok", reason: null };
};

// A message to the coordinator is answered by the first coordinator turn that starts after it
// was stored: its own, or a turn that took it together with others that waited.
const messageOutcome = async (db: Kysely<Database>, messageId: string): Promise<Outcome | null> => {
  const message = await db
    .selectFrom("chat_messages")
    .select(["session_id", "created_at"])
    .where("id", "=", messageId)
    .executeTakeFirst();
  if (!message) return null;
  const run = await db
    .selectFrom("chat_runs")
    .select(["status", "error_message"])
    .where("session_id", "=", message.session_id)
    .where("created_at", ">=", message.created_at)
    .orderBy("created_at")
    .orderBy("id")
    .executeTakeFirst();
  return run ? endedRun(run.status, run.error_message) : { status: "running", reason: null };
};

const endedRun = (status: ChatRunStatus, error: string | null): Outcome => {
  switch (status) {
    case "running":
      return { status: "running", reason: null };
    case "completed":
      return { status: "ok", reason: null };
    case "failed":
      return { status: "failed", reason: error ?? "The run failed" };
    case "cancelled":
    case "interrupted":
      return { status: "failed", reason: "The run was stopped" };
  }
};
