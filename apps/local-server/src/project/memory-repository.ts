import type { Kysely } from "kysely";
import type { MemoryFileRow } from "../db/projects-schema.ts";
import type { Database } from "../db/schema.ts";

/** One memory file of a project: the `MEMORY.md` index or a topic file. */
export interface MemoryFile {
  name: string;
  description: string;
  body: string;
  updatedAt: string;
}

export type MemoryFileInput = Pick<MemoryFile, "name" | "description" | "body">;

/** A memory file without its body, for listing many files cheaply. */
export type MemoryFileSummary = Pick<MemoryFile, "name" | "description">;

export interface MemoryRepository {
  /** Sorted by name. */
  list: (projectId: string) => Promise<MemoryFile[]>;
  /** Every file's name and description, sorted by name, without reading the bodies. */
  summaries: (projectId: string) => Promise<MemoryFileSummary[]>;
  get: (projectId: string, name: string) => Promise<MemoryFile | null>;
  /** Creates the file or replaces its description and body. */
  save: (projectId: string, file: MemoryFileInput) => Promise<MemoryFile>;
  remove: (projectId: string, name: string) => Promise<boolean>;
}

export const createMemoryRepository = (
  db: Kysely<Database>,
  now: () => Date = () => new Date(),
): MemoryRepository => ({
  list: async (projectId) => {
    const rows = await db
      .selectFrom("memory_files")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("name")
      .execute();
    return rows.map(toMemoryFile);
  },

  summaries: (projectId) =>
    db
      .selectFrom("memory_files")
      .select(["name", "description"])
      .where("project_id", "=", projectId)
      .orderBy("name")
      .execute(),

  get: async (projectId, name) => {
    const row = await db
      .selectFrom("memory_files")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("name", "=", name)
      .executeTakeFirst();
    return row ? toMemoryFile(row) : null;
  },

  save: async (projectId, file) => {
    const updatedAt = now().toISOString();
    const columns = { description: file.description, body: file.body, updated_at: updatedAt };
    await db
      .insertInto("memory_files")
      .values({ project_id: projectId, name: file.name, ...columns })
      .onConflict((oc) => oc.columns(["project_id", "name"]).doUpdateSet(columns))
      .execute();
    return { ...file, updatedAt };
  },

  remove: async (projectId, name) => {
    // The dialect reports no affected-row count, so existence is read first.
    const existing = await db
      .selectFrom("memory_files")
      .select("name")
      .where("project_id", "=", projectId)
      .where("name", "=", name)
      .executeTakeFirst();
    if (!existing) return false;
    await db
      .deleteFrom("memory_files")
      .where("project_id", "=", projectId)
      .where("name", "=", name)
      .execute();
    return true;
  },
});

const toMemoryFile = (row: MemoryFileRow): MemoryFile => ({
  name: row.name,
  description: row.description,
  body: row.body,
  updatedAt: row.updated_at,
});
