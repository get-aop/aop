import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  EventLogEntrySchema,
  HostHealthSchema,
  LiveSnapshotSchema,
  MessageDeltaSchema,
  MessageSchema,
  PairedDeviceSchema,
  ProjectSchema,
  ResyncSchema,
  ThreadSchema,
} from "@aop/common";
import { z } from "zod";

/**
 * The Android app restates the host's wire types in Kotlin (apps/mobile/shared/.../wire/Wire.kt),
 * and its tests decode these samples. Parsing the same samples with the real schemas here keeps
 * the two honest: a schema change that breaks a sample fails this suite, and the sample is then
 * updated for both sides.
 */
const FIXTURES = join(import.meta.dir, "wire-fixtures");

const CONTRACT: Record<string, z.ZodType> = {
  "health.json": HostHealthSchema,
  "paired-device.json": PairedDeviceSchema,
  "projects.json": z.object({ projects: z.array(ProjectSchema) }),
  "threads.json": z.object({ threads: z.array(ThreadSchema) }),
  "coordinator-messages.json": z.object({ messages: z.array(MessageSchema), hasMore: z.boolean() }),
  "stream-entries.json": z.array(EventLogEntrySchema),
  "delta.json": MessageDeltaSchema,
  "live.json": LiveSnapshotSchema,
  "resync.json": ResyncSchema,
};

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await Bun.file(join(FIXTURES, name)).text());

describe("mobile wire samples", () => {
  test("every sample has a schema, and every schema a sample", () => {
    const files = readdirSync(FIXTURES).filter((file) => file.endsWith(".json"));
    expect(files.sort()).toEqual(Object.keys(CONTRACT).sort());
  });

  for (const [name, schema] of Object.entries(CONTRACT)) {
    test(`${name} matches @aop/common`, async () => {
      const result = schema.safeParse(await readFixture(name));
      expect(result.error?.issues ?? []).toEqual([]);
    });
  }

  test("the threads sample covers the statuses the app renders specially", async () => {
    const { threads } = z
      .object({ threads: z.array(ThreadSchema) })
      .parse(await readFixture("threads.json"));
    expect(new Set(threads.map((thread) => thread.status))).toEqual(
      new Set(["waiting-on-you", "working", "ready-for-review", "rate-limited", "resolved"]),
    );
  });
});
