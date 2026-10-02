import type { PlanUsage } from "@aop/common";
import type { Kysely } from "kysely";
import type { RoutineRow } from "../db/routines-schema.ts";
import type { Database } from "../db/schema.ts";
import { getPlanUsage } from "../usage/plan-usage.ts";

/** When a run of the routine could start without Claude refusing it, or null when it can now. */
export type UsageLimitCheck = (routine: RoutineRow, now: Date) => Promise<string | null>;

// A window used up with no reset known is tried again after this long, as a limited run is.
const UNKNOWN_RESET_MS = 15 * 60_000;

/**
 * A run would meet the Claude plan's limit: a window the host last heard at 100% that has not
 * reset, or, for a message to the coordinator, the coordinator's own wait on a limit. Starting
 * it anyway would cost a failed turn per occurrence until the reset.
 */
export const createUsageLimitCheck =
  (
    db: Kysely<Database>,
    readUsage: () => Promise<PlanUsage | null> = getPlanUsage,
  ): UsageLimitCheck =>
  async (routine, now) => {
    const until = [planLimitUntil(await readUsage(), now)];
    if (routine.target === "coordinator") until.push(await coordinatorWait(db, routine, now));
    const known = until.filter((value): value is string => value !== null).sort();
    return known[known.length - 1] ?? null;
  };

export const planLimitUntil = (usage: PlanUsage | null, now: Date): string | null => {
  const windows = [usage?.fiveHour, usage?.sevenDay].filter(
    (window) => window && window.usedPercent >= 100,
  );
  const until = windows.flatMap((window) => {
    if (!window?.resetsAt) return [new Date(now.getTime() + UNKNOWN_RESET_MS).toISOString()];
    return Date.parse(window.resetsAt) > now.getTime() ? [window.resetsAt] : [];
  });
  return until.sort()[until.length - 1] ?? null;
};

const coordinatorWait = async (
  db: Kysely<Database>,
  routine: RoutineRow,
  now: Date,
): Promise<string | null> => {
  const coordinator = await db
    .selectFrom("chat_sessions")
    .select("resumes_at")
    .where("project_id", "=", routine.project_id)
    .where("kind", "=", "coordinator")
    .executeTakeFirst();
  const resumesAt = coordinator?.resumes_at;
  return resumesAt && Date.parse(resumesAt) > now.getTime() ? resumesAt : null;
};
