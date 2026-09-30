import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Message } from "@aop/common";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createProjectRepository } from "../project/repository.ts";
import { insertProjectRow, insertProjectSession, projectSettings } from "../project/test-utils.ts";
import { createThreadRepository } from "../thread/repository.ts";
import { createEventLogRepository, type EventLogRepository } from "./repository.ts";

describe("event log repository", () => {
  let db: Kysely<Database>;
  let log: EventLogRepository;

  beforeEach(async () => {
    db = await createTestDb();
    log = createEventLogRepository(db);
    await insertProjectRow(db, "p1");
    await insertProjectRow(db, "p2");
  });

  afterEach(async () => {
    await db.destroy();
  });

  const removed = (projectId: string, threadId: string) =>
    ({ projectId, type: "thread.removed", payload: { threadId } }) as const;

  test("assigns increasing ids and returns the stored entry", async () => {
    const first = await log.append(removed("p1", "t1"));
    const second = await log.append(removed("p1", "t2"));

    expect(first).toEqual({ id: first.id, ...removed("p1", "t1") });
    expect(second.id).toBeGreaterThan(first.id);
  });

  test("resumes after a cursor, oldest first, without another project's entries", async () => {
    const first = await log.append(removed("p1", "t1"));
    await log.append(removed("p2", "other"));
    const second = await log.append(removed("p1", "t2"));
    const third = await log.append(removed("p1", "t3"));

    expect(await log.listAfter("p1", 0)).toEqual([first, second, third]);
    expect(await log.listAfter("p1", first.id)).toEqual([second, third]);
    expect(await log.listAfter("p1", third.id)).toEqual([]);
  });

  test("returns at most one page at a time", async () => {
    const entries = [];
    for (const threadId of ["t1", "t2", "t3"]) {
      entries.push(await log.append(removed("p1", threadId)));
    }

    expect(await log.listAfter("p1", 0, 2)).toEqual(entries.slice(0, 2));
  });

  test("carries whole entities: a project, a thread and a message read back equal", async () => {
    const project = await createProjectRepository(db).create({ id: "p3", ...projectSettings() });
    await insertProjectSession(db, { id: "thread-1", projectId: "p3", kind: "thread" });
    const thread = await createThreadRepository(db).getById("thread-1");
    if (!thread) throw new Error("seeded thread is missing");
    const message: Message = {
      id: "m1",
      projectId: "p3",
      threadId: "thread-1",
      createdAt: "2026-09-30T09:00:00.000Z",
      role: "assistant",
      blocks: [{ type: "text", text: "Started." }],
    };

    const appended = [
      await log.append({ projectId: "p3", type: "project.upserted", payload: { project } }),
      await log.append({ projectId: "p3", type: "thread.upserted", payload: { thread } }),
      await log.append({ projectId: "p3", type: "message.created", payload: { message } }),
      await log.append({ projectId: "p3", type: "project.removed", payload: {} }),
    ];

    expect(await log.listAfter("p3", 0)).toEqual(appended);
  });

  test("refuses an entry filed under a project other than its payload's, and stores nothing", async () => {
    const project = await createProjectRepository(db).create({ id: "p3", ...projectSettings() });

    await expect(
      log.append({ projectId: "p1", type: "project.upserted", payload: { project } }),
    ).rejects.toThrow(/projectId must match/);

    expect(await log.listAfter("p1", 0)).toEqual([]);
  });

  test("an entry appended inside a transaction exists only if the transaction commits", async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await createEventLogRepository(trx).append(removed("p1", "t1"));
        throw new Error("state change failed");
      }),
    ).rejects.toThrow("state change failed");
    expect(await log.listAfter("p1", 0)).toEqual([]);

    await db.transaction().execute(async (trx) => {
      await createEventLogRepository(trx).append(removed("p1", "t1"));
    });
    expect(await log.listAfter("p1", 0)).toHaveLength(1);
  });

  test("counts a project's backlog after a cursor", async () => {
    const first = await log.append(removed("p1", "t1"));
    await log.append(removed("p2", "other"));
    await log.append(removed("p1", "t2"));

    expect(await log.countAfter("p1", 0)).toBe(2);
    expect(await log.countAfter("p1", first.id)).toBe(1);
    expect(await log.countAfter("p3", 0)).toBe(0);
  });

  test("finds a project's newest entry of a type after a cursor", async () => {
    const first = await log.append({ projectId: "p1", type: "project.removed", payload: {} });
    await log.append(removed("p1", "t1"));
    const second = await log.append({ projectId: "p1", type: "project.removed", payload: {} });
    await log.append({ projectId: "p2", type: "project.removed", payload: {} });

    expect(await log.findLatest("p1", "project.removed", 0)).toEqual(second);
    expect(await log.findLatest("p1", "project.removed", first.id)).toEqual(second);
    expect(await log.findLatest("p1", "project.removed", second.id)).toBeNull();
    expect(await log.findLatest("p1", "thread.upserted", 0)).toBeNull();
  });

  test("a project.removed entry outlives the project it announces", async () => {
    await createProjectRepository(db).create({ id: "p3", ...projectSettings() });
    await db.transaction().execute(async (trx) => {
      await createProjectRepository(trx).remove("p3");
      await createEventLogRepository(trx).append({
        projectId: "p3",
        type: "project.removed",
        payload: {},
      });
    });

    expect(await createProjectRepository(db).getById("p3")).toBeNull();
    expect(await log.listAfter("p3", 0)).toEqual([
      { id: expect.any(Number), projectId: "p3", type: "project.removed", payload: {} },
    ]);
  });

  describe("cursor bounds", () => {
    test("an empty log has trimmed nothing and its latest id is 0", async () => {
      expect(await log.trimFloor()).toBe(0);
      expect(await log.latestId()).toBe(0);
    });

    test("an untrimmed log is complete from the start, and its latest id is the newest entry's", async () => {
      await log.append(removed("p1", "t1"));
      await log.append(removed("p2", "t2"));
      const third = await log.append(removed("p1", "t3"));

      expect(await log.trimFloor()).toBe(0);
      expect(await log.latestId()).toBe(third.id);
    });
  });

  describe("trimming", () => {
    // Odd ids belong to p2, even ones to p1. The database is fresh, so ids run 1, 2, 3...
    const appendMany = async (count: number) => {
      for (let n = 1; n <= count; n++) {
        await log.append(removed(n % 2 === 0 ? "p1" : "p2", `t${n}`));
      }
    };
    const idsOf = async (projectId: string) =>
      (await log.listAfter(projectId, 0)).map((entry) => entry.id);

    test("keeps the newest entries of every project and drops the oldest prefix", async () => {
      await appendMany(6);

      await log.trimToNewest(4);

      expect(await log.trimFloor()).toBe(2);
      expect(await idsOf("p1")).toEqual([4, 6]);
      expect(await idsOf("p2")).toEqual([3, 5]);
    });

    test("does nothing while the log is not longer than the limit", async () => {
      await appendMany(3);

      await log.trimToNewest(3);
      await log.trimToNewest(10);

      expect(await log.trimFloor()).toBe(0);
      expect(await idsOf("p1")).toEqual([2]);
      expect(await idsOf("p2")).toEqual([1, 3]);
    });

    test("never reuses an id, even after everything was trimmed", async () => {
      await appendMany(3);

      await log.trimToNewest(0);
      const next = await log.append(removed("p1", "after"));

      expect(next.id).toBe(4);
      expect(await log.listAfter("p1", 0)).toEqual([next]);
      expect(await log.latestId()).toBe(4);
    });

    test("puts the floor at the newest id when the log was emptied", async () => {
      await appendMany(2);

      await log.trimToNewest(0);

      expect(await log.trimFloor()).toBe(2);
      expect(await log.latestId()).toBe(2);
    });

    test("refuses a negative or fractional limit", async () => {
      await expect(log.trimToNewest(-1)).rejects.toThrow(RangeError);
      await expect(log.trimToNewest(1.5)).rejects.toThrow(RangeError);
    });
  });

  test("a stored entry that no longer matches its type fails loudly when read", async () => {
    await db
      .insertInto("event_log")
      .values({ project_id: "p1", type: "thread.removed", payload: "{}" })
      .execute();

    await expect(log.listAfter("p1", 0)).rejects.toThrow();
  });
});
