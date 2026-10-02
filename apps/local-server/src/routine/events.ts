import type { PublisherTransaction } from "../event-log/publisher.ts";
import { createRoutineRepository } from "./repository.ts";
import { toRoutine, toRuns } from "./wire.ts";

/*
 * Routine entries on the project's event log, appended inside the transaction that makes the
 * change and read as that transaction sees it, like the project's own entries (project/events.ts).
 */

export const recordRoutineUpserted = async (
  tx: PublisherTransaction,
  routineId: string,
): Promise<void> => {
  const routines = createRoutineRepository(tx.db);
  const row = await routines.getById(routineId);
  if (!row) return;
  const latest = (await routines.latestRuns([routineId])).get(routineId);
  const [lastRun] = latest ? await toRuns(tx.db, [latest]) : [];
  await tx.append({
    type: "routine.upserted",
    projectId: row.project_id,
    payload: { routine: toRoutine(row, lastRun ?? null) },
  });
};

export const recordRoutineRemoved = async (
  tx: PublisherTransaction,
  projectId: string,
  routineId: string,
): Promise<void> => {
  await tx.append({ type: "routine.removed", projectId, payload: { routineId } });
};
