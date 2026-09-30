import type { Device } from "@aop/common";
import type { Kysely } from "kysely";
import type { DeviceRow } from "../db/projects-schema.ts";
import type { Database } from "../db/schema.ts";

export interface NewDevice {
  id: string;
  name: string;
  /** Hash of the bearer token. The token itself never reaches the repository. */
  tokenHash: string;
}

/**
 * Results are the wire `Device`, which has no token hash, so the hash can only leave the
 * repository by being looked up, never by being read back.
 */
export interface DeviceRepository {
  create: (device: NewDevice) => Promise<Device>;
  findByTokenHash: (tokenHash: string) => Promise<Device | null>;
  /** Oldest first. */
  list: () => Promise<Device[]>;
  touchLastSeen: (id: string) => Promise<void>;
  /** Revokes the device: its token stops matching. */
  remove: (id: string) => Promise<boolean>;
}

export const createDeviceRepository = (
  db: Kysely<Database>,
  now: () => Date = () => new Date(),
): DeviceRepository => ({
  create: async (device) => {
    const createdAt = now().toISOString();
    await db
      .insertInto("devices")
      .values({
        id: device.id,
        name: device.name,
        token_hash: device.tokenHash,
        created_at: createdAt,
      })
      .execute();
    return { id: device.id, name: device.name, createdAt, lastSeenAt: null };
  },

  findByTokenHash: async (tokenHash) => {
    const row = await db
      .selectFrom("devices")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .executeTakeFirst();
    return row ? toDevice(row) : null;
  },

  list: async () => {
    const rows = await db
      .selectFrom("devices")
      .selectAll()
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    return rows.map(toDevice);
  },

  touchLastSeen: async (id) => {
    await db
      .updateTable("devices")
      .set({ last_seen_at: now().toISOString() })
      .where("id", "=", id)
      .execute();
  },

  remove: async (id) => {
    // The dialect reports no affected-row count, so existence is read first.
    const existing = await db
      .selectFrom("devices")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!existing) return false;
    await db.deleteFrom("devices").where("id", "=", id).execute();
    return true;
  },
});

const toDevice = (row: DeviceRow): Device => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
});
