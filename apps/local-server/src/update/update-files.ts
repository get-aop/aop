import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";

// Two files, each with one writer: the host writes what the last check saw, and the updater
// process (`aop update`, which outlives the host it restarts) writes how its run ended.

/** What the last successful check of the release feed saw. */
export interface CheckRecord {
  checkedAt: string;
  latest: string;
  releaseUrl: string;
}

/** How the last update run ended. `from` is the release it started on. */
export interface OutcomeRecord {
  at: string;
  ok: boolean;
  from: string;
  to: string | null;
  error: string | null;
}

export const readCheckRecord = (home: string = aopPaths.home()): Promise<CheckRecord | null> =>
  readJson(join(home, "update-check.json"), isCheckRecord);

export const writeCheckRecord = (
  record: CheckRecord,
  home: string = aopPaths.home(),
): Promise<void> => writeJson(join(home, "update-check.json"), record);

export const readOutcomeRecord = (home: string = aopPaths.home()): Promise<OutcomeRecord | null> =>
  readJson(join(home, "update-outcome.json"), isOutcomeRecord);

export const writeOutcomeRecord = (
  record: OutcomeRecord,
  home: string = aopPaths.home(),
): Promise<void> => writeJson(join(home, "update-outcome.json"), record);

const readJson = async <T>(
  path: string,
  guard: (value: unknown) => value is T,
): Promise<T | null> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

// Written beside its target and renamed over it, so a reader never sees half a file.
const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true });
  const partial = `${path}.${process.pid}.tmp`;
  await writeFile(partial, JSON.stringify(value));
  await rename(partial, path);
};

const isCheckRecord = (value: unknown): value is CheckRecord => {
  const record = value as Partial<CheckRecord> | null;
  return (
    typeof record?.checkedAt === "string" &&
    typeof record.latest === "string" &&
    typeof record.releaseUrl === "string"
  );
};

const isOutcomeRecord = (value: unknown): value is OutcomeRecord => {
  const record = value as Partial<OutcomeRecord> | null;
  return (
    typeof record?.at === "string" &&
    typeof record.ok === "boolean" &&
    typeof record.from === "string"
  );
};
