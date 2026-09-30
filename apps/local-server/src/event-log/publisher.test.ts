import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createProjectRepository } from "../project/repository.ts";
import { createEventPublisher, type EventPublisher } from "./publisher.ts";
import { createEventLogRepository } from "./repository.ts";
import { createProjects, liveText, projectRemoved, threadRemoved } from "./test-utils.ts";

describe("event publisher", () => {
  let db: Kysely<Database>;
  let publisher: EventPublisher;

  beforeEach(async () => {
    db = await createTestDb();
    await createProjects(db, "p1", "p2");
    publisher = createEventPublisher(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const listen = (projectId: string) => {
    const heard = { commits: 0, deltas: [] as unknown[] };
    const subscription = publisher.subscribe(projectId, {
      onCommit: () => {
        heard.commits++;
      },
      onDelta: (delta) => heard.deltas.push(delta),
    });
    return { heard, subscription };
  };

  const stored = (projectId: string) => createEventLogRepository(db).listAfter(projectId, 0);

  describe("publish", () => {
    test("stores the entry and tells the listeners of its project, not of another", async () => {
      const mine = listen("p1");
      const theirs = listen("p2");

      const entry = await publisher.publish(threadRemoved("p1", "t1"));

      expect(await stored("p1")).toEqual([entry]);
      expect(mine.heard.commits).toBe(1);
      expect(theirs.heard.commits).toBe(0);
    });

    test("refuses an entry that could not be read back, and tells no one", async () => {
      const { heard } = listen("p1");

      await expect(
        publisher.publish({ projectId: "p1", type: "thread.removed", payload: {} } as never),
      ).rejects.toThrow();

      expect(heard.commits).toBe(0);
      expect(await stored("p1")).toEqual([]);
    });

    test("stops telling a listener that unsubscribed", async () => {
      const { heard, subscription } = listen("p1");
      subscription.unsubscribe();

      await publisher.publish(threadRemoved("p1", "t1"));

      expect(heard.commits).toBe(0);
    });

    test("a listener that throws does not fail the writer or keep the others from hearing", async () => {
      publisher.subscribe("p1", {
        onCommit: () => {
          throw new Error("broken stream");
        },
        onDelta: () => {},
      });
      const { heard } = listen("p1");

      const entry = await publisher.publish(threadRemoved("p1", "t1"));

      expect(await stored("p1")).toEqual([entry]);
      expect(heard.commits).toBe(1);
    });
  });

  describe("transaction", () => {
    const removeProject = (projectId: string) =>
      publisher.transaction(async ({ db: trx, append }) => {
        await createProjectRepository(trx).remove(projectId);
        return append(projectRemoved(projectId));
      });

    test("stores the entry with the state change, and tells listeners only after the commit", async () => {
      const { heard } = listen("p1");
      let heardBeforeCommit = -1;

      const removal = await publisher.transaction(async ({ db: trx, append }) => {
        await createProjectRepository(trx).remove("p1");
        const appended = await append(projectRemoved("p1"));
        heardBeforeCommit = heard.commits;
        return appended;
      });

      expect(heardBeforeCommit).toBe(0);
      expect(heard.commits).toBe(1);
      expect(await createProjectRepository(db).getById("p1")).toBeNull();
      expect(await stored("p1")).toEqual([removal]);
    });

    test("when the work fails, neither the state change nor the entry exists, and no one is told", async () => {
      const { heard } = listen("p1");

      await expect(
        publisher.transaction(async ({ db: trx, append }) => {
          await createProjectRepository(trx).remove("p1");
          await append(projectRemoved("p1"));
          throw new Error("the rest of the change failed");
        }),
      ).rejects.toThrow("the rest of the change failed");

      expect(await createProjectRepository(db).getById("p1")).not.toBeNull();
      expect(await stored("p1")).toEqual([]);
      expect(heard.commits).toBe(0);
    });

    test("tells each project once, however many of its entries were appended", async () => {
      const one = listen("p1");
      const two = listen("p2");

      const entries = await publisher.transaction(async ({ append }) => [
        await append(threadRemoved("p1", "t1")),
        await append(threadRemoved("p2", "t2")),
        await append(threadRemoved("p1", "t3")),
      ]);

      expect(entries.map((entry) => entry.id)).toEqual(
        [...entries.map((entry) => entry.id)].sort((a, b) => a - b),
      );
      expect(one.heard.commits).toBe(1);
      expect(two.heard.commits).toBe(1);
    });

    test("removes a project whose entry outlives it, so a client can still be told", async () => {
      const removal = await removeProject("p1");

      expect(await createProjectRepository(db).getById("p1")).toBeNull();
      expect(await createEventLogRepository(db).findLatest("p1", "project.removed", 0)).toEqual(
        removal,
      );
    });
  });

  describe("live text", () => {
    test("goes to the project's listeners in order and is not stored", async () => {
      const { heard } = listen("p1");
      const other = listen("p2");

      publisher.publishLive(liveText({ text: "Hel" }));
      publisher.publishLive(liveText({ text: "lo" }));

      expect(heard.deltas).toEqual([liveText({ text: "Hel" }), liveText({ text: "lo" })]);
      expect(other.heard.deltas).toEqual([]);
      expect(await stored("p1")).toEqual([]);
    });

    test("is handed to a new subscriber as the text so far", () => {
      publisher.publishLive(liveText({ text: "Hel" }));
      publisher.publishLive(liveText({ text: "lo" }));

      const { subscription } = listen("p1");

      expect(subscription.runningTurns).toEqual([liveText({ text: "Hello", replace: true })]);
    });
  });

  describe("trimming", () => {
    test("keeps the newest entries each time an id reaches the trim interval, and never reuses an id", async () => {
      const trimming = createEventPublisher(db, { maxEntries: 5, trimEvery: 4 });
      const log = createEventLogRepository(db);

      const ids: number[] = [];
      for (let n = 1; n <= 12; n++) {
        ids.push((await trimming.publish(threadRemoved("p1", `t${n}`))).id);
      }
      // Id 4 trims nothing (four rows), id 8 deletes ids 1-3, and id 12 deletes 4-7.
      const kept = (await log.listAfter("p1", 0)).map((entry) => entry.id);
      const next = await trimming.publish(threadRemoved("p1", "t13"));

      expect(kept).toEqual([8, 9, 10, 11, 12]);
      expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(next.id).toBe(13);
    });

    test("a transaction that crosses the interval trims after it commits", async () => {
      const trimming = createEventPublisher(db, { maxEntries: 2, trimEvery: 3 });

      await trimming.transaction(async ({ append }) => {
        for (let n = 1; n <= 3; n++) await append(threadRemoved("p1", `t${n}`));
      });

      expect((await stored("p1")).map((entry) => entry.id)).toEqual([2, 3]);
    });
  });
});
