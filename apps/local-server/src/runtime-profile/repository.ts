import type { RuntimeProfile, RuntimeProfileInput, RuntimeProfilePatch } from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database, RuntimeProfileRecord } from "../db/schema.ts";

export interface RuntimeProfileRepository {
  list: () => Promise<RuntimeProfile[]>;
  get: (id: string) => Promise<RuntimeProfile | null>;
  create: (input: RuntimeProfileInput) => Promise<RuntimeProfile>;
  update: (id: string, patch: RuntimeProfilePatch) => Promise<RuntimeProfile | null>;
  delete: (id: string) => Promise<boolean>;
}

export const createRuntimeProfileRepository = (db: Kysely<Database>): RuntimeProfileRepository => ({
  list: async () => {
    const records = await db
      .selectFrom("runtime_profiles")
      .selectAll()
      .orderBy(sql`name COLLATE NOCASE`)
      .execute();
    return records.map(toRuntimeProfile);
  },

  get: async (id) => {
    const record = await db
      .selectFrom("runtime_profiles")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return record ? toRuntimeProfile(record) : null;
  },

  create: async (input) => {
    const record = await db
      .insertInto("runtime_profiles")
      .values(toInsertRecord(input))
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRuntimeProfile(record);
  },

  update: async (id, patch) => {
    const record = await db
      .updateTable("runtime_profiles")
      .set({ ...toUpdateRecord(patch), updated_at: sql`datetime('now')` })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return record ? toRuntimeProfile(record) : null;
  },

  delete: async (id) => {
    const result = await db.deleteFrom("runtime_profiles").where("id", "=", id).executeTakeFirst();
    return result.numDeletedRows > 0n;
  },
});

const toInsertRecord = (input: RuntimeProfileInput) => ({
  id: generateTypeId("rprof"),
  name: input.name,
  base_provider: input.baseProvider,
  command: input.command,
  model: input.model,
  reasoning: input.reasoning,
  fast_mode: input.fastMode,
  exec_host_id: input.execHostId?.trim() ? input.execHostId : null,
});

const toUpdateRecord = (patch: RuntimeProfilePatch) => ({
  ...(patch.name === undefined ? {} : { name: patch.name }),
  ...(patch.baseProvider === undefined ? {} : { base_provider: patch.baseProvider }),
  ...(patch.command === undefined ? {} : { command: patch.command }),
  ...(patch.model === undefined ? {} : { model: patch.model }),
  ...(patch.reasoning === undefined ? {} : { reasoning: patch.reasoning }),
  ...(patch.fastMode === undefined ? {} : { fast_mode: patch.fastMode }),
  // Empty string clears the binding; omit when the field is not in the patch.
  ...("execHostId" in patch
    ? { exec_host_id: patch.execHostId?.trim() ? patch.execHostId : null }
    : {}),
});

const toRuntimeProfile = (record: RuntimeProfileRecord): RuntimeProfile => ({
  id: record.id,
  name: record.name,
  baseProvider: record.base_provider as RuntimeProfile["baseProvider"],
  command: record.command,
  model: record.model,
  reasoning: record.reasoning as RuntimeProfile["reasoning"],
  fastMode: Boolean(record.fast_mode),
  ...(record.exec_host_id ? { execHostId: record.exec_host_id } : {}),
  createdAt: record.created_at,
  updatedAt: record.updated_at,
});
