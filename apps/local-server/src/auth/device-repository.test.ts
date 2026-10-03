import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DeviceSchema } from "@aop/common";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createDeviceRepository, type DeviceRepository } from "./device-repository.ts";

const T0 = new Date("2026-09-30T09:00:00.000Z");
const T1 = new Date("2026-09-30T10:00:00.000Z");

describe("device repository", () => {
  let db: Kysely<Database>;
  let clock: Date;
  let devices: DeviceRepository;

  beforeEach(async () => {
    db = await createTestDb();
    clock = T0;
    devices = createDeviceRepository(db, () => clock);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("a created device is the wire shape and carries no token hash", async () => {
    const device = await devices.create({ id: "d1", name: "Work Mac", tokenHash: "hash-1" });

    expect(device).toEqual({
      id: "d1",
      name: "Work Mac",
      createdAt: T0.toISOString(),
      lastSeenAt: null,
      client: null,
    });
    expect(DeviceSchema.safeParse(device).success).toBe(true);
  });

  test("keeps the client a device paired from, and the one it connected with last", async () => {
    const paired = await devices.create({
      id: "d1",
      name: "Work Mac",
      tokenHash: "hash-1",
      client: { app: "desktop", version: "0.10.7", platform: "darwin" },
    });
    expect(paired.client).toEqual({ app: "desktop", version: "0.10.7", platform: "darwin" });

    await devices.recordClient("d1", { app: "browser", version: null, platform: "linux" });

    expect((await devices.findByTokenHash("hash-1"))?.client).toEqual({
      app: "browser",
      version: null,
      platform: "linux",
    });
  });

  test("reads an app it does not know as no client", async () => {
    await devices.create({ id: "d1", name: "Work Mac", tokenHash: "hash-1" });
    await db.updateTable("devices").set({ client_app: "tv" }).where("id", "=", "d1").execute();

    expect((await devices.findByTokenHash("hash-1"))?.client).toBeNull();
  });

  test("finds a device by its token hash and only by that hash", async () => {
    const created = await devices.create({ id: "d1", name: "Work Mac", tokenHash: "hash-1" });
    await devices.create({ id: "d2", name: "Windows PC", tokenHash: "hash-2" });

    expect(await devices.findByTokenHash("hash-1")).toEqual(created);
    expect(await devices.findByTokenHash("hash-3")).toBeNull();
    const found = await devices.findByTokenHash("hash-2");
    expect(Object.keys(found ?? {}).sort()).toEqual([
      "client",
      "createdAt",
      "id",
      "lastSeenAt",
      "name",
    ]);
  });

  test("records when a device was last seen", async () => {
    await devices.create({ id: "d1", name: "Work Mac", tokenHash: "hash-1" });
    clock = T1;

    await devices.touchLastSeen("d1");

    expect((await devices.findByTokenHash("hash-1"))?.lastSeenAt).toBe(T1.toISOString());
  });

  test("lists devices oldest first", async () => {
    await devices.create({ id: "d-old", name: "Old", tokenHash: "h-old" });
    clock = T1;
    await devices.create({ id: "d-new", name: "New", tokenHash: "h-new" });

    expect((await devices.list()).map((device) => device.id)).toEqual(["d-old", "d-new"]);
  });

  test("removing a device revokes its token", async () => {
    await devices.create({ id: "d1", name: "Work Mac", tokenHash: "hash-1" });

    expect(await devices.remove("d1")).toBe(true);
    expect(await devices.remove("d1")).toBe(false);

    expect(await devices.findByTokenHash("hash-1")).toBeNull();
    expect(await devices.list()).toEqual([]);
  });

  test("refuses a second device with the same token hash", async () => {
    await devices.create({ id: "d1", name: "Work Mac", tokenHash: "hash-1" });

    await expect(
      devices.create({ id: "d2", name: "Windows PC", tokenHash: "hash-1" }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});
