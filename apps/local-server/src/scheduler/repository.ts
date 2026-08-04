import type { Kysely } from "kysely";
import type {
  Database,
  NewSchedulerTrigger,
  SchedulerTrigger,
  SchedulerTriggerUpdate,
} from "../db/schema.ts";

export interface SchedulerRepository {
  create: (trigger: NewSchedulerTrigger) => Promise<SchedulerTrigger>;
  getById: (id: string) => Promise<SchedulerTrigger | null>;
  listByRepoId: (repoId: string) => Promise<SchedulerTrigger[]>;
  listAll: () => Promise<SchedulerTrigger[]>;
  update: (id: string, updates: SchedulerTriggerUpdate) => Promise<SchedulerTrigger | null>;
  delete: (id: string) => Promise<boolean>;
}

export const createSchedulerRepository = (db: Kysely<Database>): SchedulerRepository => {
  const coerceTrigger = (row: SchedulerTrigger): SchedulerTrigger => ({
    ...row,
    enabled: Boolean(row.enabled),
    require_approval_before_handoff: Boolean(row.require_approval_before_handoff),
  });

  return {
    create: async (trigger) => {
      await db.insertInto("scheduler_triggers").values(trigger).execute();
      const row = await db
        .selectFrom("scheduler_triggers")
        .selectAll()
        .where("id", "=", trigger.id)
        .executeTakeFirst();
      if (!row) throw new Error("Failed to create scheduler trigger");
      return coerceTrigger(row);
    },

    getById: async (id) => {
      const row = await db
        .selectFrom("scheduler_triggers")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return row ? coerceTrigger(row) : null;
    },

    listByRepoId: async (repoId) =>
      (
        await db
          .selectFrom("scheduler_triggers")
          .selectAll()
          .where("repo_id", "=", repoId)
          .orderBy("created_at", "asc")
          .execute()
      ).map(coerceTrigger),

    listAll: async () =>
      (
        await db.selectFrom("scheduler_triggers").selectAll().orderBy("created_at", "asc").execute()
      ).map(coerceTrigger),

    update: async (id, updates) => {
      const existing = await db
        .selectFrom("scheduler_triggers")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (!existing) return null;
      const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
      await db.updateTable("scheduler_triggers").set(updates).where("id", "=", id).execute();
      return coerceTrigger(updated);
    },

    delete: async (id) => {
      const result = await db
        .deleteFrom("scheduler_triggers")
        .where("id", "=", id)
        .executeTakeFirst();
      return (result?.numDeletedRows ?? 0n) > 0n;
    },
  };
};
