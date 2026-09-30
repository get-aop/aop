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

  test("a stored entry that no longer matches its type fails loudly when read", async () => {
    await db
      .insertInto("event_log")
      .values({ project_id: "p1", type: "thread.removed", payload: "{}" })
      .execute();

    await expect(log.listAfter("p1", 0)).rejects.toThrow();
  });
});
