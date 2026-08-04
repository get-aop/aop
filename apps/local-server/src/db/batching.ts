/**
 * SQLite refuses statements with more bound parameters than its compile-time
 * limit (999 on builds before 3.32). Chunk every bulk read, write, and delete
 * below that ceiling instead of relying on the runtime's actual limit.
 */
export const SQLITE_MAX_BIND_PARAMETERS = 900;

/** Batch size for single-column `IN (...)` lists. */
export const ID_BATCH_SIZE = 500;

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];
  const step = Math.max(1, size);
  for (let index = 0; index < items.length; index += step) {
    batches.push(items.slice(index, index + step));
  }
  return batches;
};

export const chunkIds = <T>(ids: readonly T[]): T[][] => chunk(ids, ID_BATCH_SIZE);

/** Splits insert rows so `rows × columns` stays under the bind-parameter cap. */
export const chunkRows = <T extends object>(rows: readonly T[]): T[][] => {
  if (rows.length === 0) return [];
  const columnCount = Math.max(1, Object.keys(rows[0] as object).length);
  return chunk(rows, Math.floor(SQLITE_MAX_BIND_PARAMETERS / columnCount));
};
