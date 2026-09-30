import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { serializeMessageOrigin } from "../chat-session/message-origin.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import { newFix, newReport } from "./ledger.ts";
import { createWatchRepository, type WatchRepository } from "./repository.ts";

const AT = new Date("2026-09-30T12:00:00.000Z");

describe("watch repository", () => {
  let db: Kysely<Database>;
  let watch: WatchRepository;

  beforeEach(async () => {
    db = await createTestDb();
    watch = createWatchRepository(db);
    await insertProjectRow(db, "p1");
    await insertProjectRow(db, "p2");
    await db
      .insertInto("repos")
      .values({ id: "r1", path: "/work/r1", name: "r1", remote_origin: null })
      .execute();
    await db.updateTable("projects").set({ status: "paused" }).where("id", "=", "p2").execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const thread = (
    id: string,
    columns: Parameters<typeof insertProjectSession>[2] = {},
    projectId = "p1",
  ) => insertProjectSession(db, { id, projectId, kind: "thread" }, { repo_id: "r1", ...columns });

  const storeMessage = (sessionId: string, origin: Parameters<typeof serializeMessageOrigin>[0]) =>
    db
      .insertInto("chat_messages")
      .values({
        id: `m-${crypto.randomUUID()}`,
        session_id: sessionId,
        role: "user",
        content: "fix it",
        origin_json: serializeMessageOrigin(origin),
      })
      .execute();

  test("remembers nothing for a thread it has not seen, and what it is told for one it has", async () => {
    await thread("t1");
    expect(await watch.entries("t1")).toEqual([]);

    const fix = newFix(["k"], "failing checks: test", AT);
    expect(await watch.claimFix("t1", fix, 3)).toBe(true);
    await watch.confirmFix("t1", fix.id);
    const cap = newReport("cap", "gave up", AT);
    await watch.record("t1", cap);

    expect(await watch.entries("t1")).toEqual([{ ...fix, delivered: true }, cap]);
    expect(await watch.entries("t2")).toEqual([]);
  });

  test("a fix is claimed once: at the cap, or for an occurrence already answered, the claim is refused", async () => {
    await thread("t1");
    const first = newFix(["a"], "a", AT);
    expect(await watch.claimFix("t1", first, 2)).toBe(true);

    expect(await watch.claimFix("t1", newFix(["a"], "again", AT), 2)).toBe(false);
    expect(await watch.claimFix("t1", newFix(["b"], "b", AT), 2)).toBe(true);
    expect(await watch.claimFix("t1", newFix(["c"], "c", AT), 2)).toBe(false);
    expect((await watch.entries("t1")).map((entry) => entry.keys)).toEqual([["a"], ["b"]]);
  });

  test("releasing a claim frees its occurrences to be sent again", async () => {
    await thread("t1");
    const fix = newFix(["a"], "a", AT);
    await watch.claimFix("t1", fix, 3);

    await watch.releaseFix("t1", fix.id);

    expect(await watch.entries("t1")).toEqual([]);
    expect(await watch.claimFix("t1", newFix(["a"], "a", AT), 3)).toBe(true);
  });

  test("settles a claim a crash left behind by whether the thread holds the message that names it", async () => {
    await thread("t1");
    const sent = newFix(["a"], "sent", AT);
    const lost = newFix(["b"], "lost", AT);
    await watch.claimFix("t1", sent, 3);
    await watch.claimFix("t1", lost, 3);
    await storeMessage("t1", { type: "pull-request-watch", claimId: sent.id });
    // Another session's message, and a message of the thread's that names another claim, prove nothing.
    await thread("t2");
    await storeMessage("t2", { type: "pull-request-watch", claimId: lost.id });
    await storeMessage("t1", { type: "pull-request-watch", claimId: "someone-else" });

    await watch.reconcileFixes("t1");

    expect(await watch.entries("t1")).toEqual([{ ...sent, delivered: true }]);
  });

  test("its changes commit and roll back with the transaction they were made in", async () => {
    await thread("t1");
    const fix = newFix(["a"], "a", AT);

    await expect(
      db.transaction().execute(async (trx) => {
        await createWatchRepository(trx).claimFix("t1", fix, 3);
        throw new Error("the message was not stored");
      }),
    ).rejects.toThrow("the message was not stored");

    expect(await watch.entries("t1")).toEqual([]);
  });

  test("lists the threads whose pull request is open in a project that is running, and no others", async () => {
    const pr = (number: number, state: "open" | "merged" = "open") => ({
      pr_number: number,
      pr_url: `https://github.com/acme/widget/pull/${number}`,
      pr_state: state,
    });
    await thread("open", pr(7));
    await thread("landing", { ...pr(6), state: "landing" });
    await thread("merged", pr(8, "merged"));
    await thread("no-pr");
    await thread("paused", pr(9), "p2");
    await insertProjectSession(db, { id: "coordinator", projectId: "p1", kind: "coordinator" });

    expect(await watch.listOpen()).toEqual([{ threadId: "open", repoId: "r1" }]);
  });
});
