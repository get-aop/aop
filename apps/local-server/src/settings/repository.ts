import type { Kysely } from "kysely";
import type { Database, Setting } from "../db/schema.ts";
import { DEFAULT_SETTINGS, type SettingKey } from "./types.ts";

export interface SettingsRepository {
  get: (key: SettingKey) => Promise<string>;
  set: (key: SettingKey, value: string) => Promise<void>;
  setAll: (entries: { key: SettingKey; value: string }[]) => Promise<void>;
  getAll: () => Promise<Setting[]>;
}

export const createSettingsRepository = (db: Kysely<Database>): SettingsRepository => {
  // Queue/scheduler loops read settings every tick; memoize in-process and
  // invalidate on writes.
  const memo = new Map<SettingKey, string>();

  return {
    get: async (key: SettingKey): Promise<string> => {
      const cached = memo.get(key);
      if (cached !== undefined) return cached;

      const setting = await db
        .selectFrom("settings")
        .select("value")
        .where("key", "=", key)
        .executeTakeFirst();

      const value = setting?.value ?? DEFAULT_SETTINGS[key];
      memo.set(key, value);
      return value;
    },

    set: async (key: SettingKey, value: string): Promise<void> => {
      memo.set(key, value);
      await db
        .insertInto("settings")
        .values({ key, value })
        .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
        .execute();
    },

    setAll: async (entries: { key: SettingKey; value: string }[]): Promise<void> => {
      for (const { key, value } of entries) {
        memo.set(key, value);
        await db
          .insertInto("settings")
          .values({ key, value })
          .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
          .execute();
      }
    },

    getAll: async (): Promise<Setting[]> => {
      return db.selectFrom("settings").selectAll().execute();
    },
  };
};
