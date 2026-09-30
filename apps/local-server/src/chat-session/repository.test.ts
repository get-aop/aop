import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely, KyselyPlugin } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { CleanupManifestError } from "./checkpoint-cleanup-manifest.ts";
import { createChatSessionRepository, insertAnsweredRuns } from "./repository.ts";
import { StaleChatSessionError } from "./session-graph-deletion.ts";
import {
  countChatRows,
  listCleanupJobs,
  revertBackupRef,
  runCheckpointRef,
  seedChatSessionGraph,
  seedRevertOperation,
} from "./test-utils.ts";

const TARGET = "csess_delete";
const KEEP = "csess_keep";

describe("chat session repository list", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("loads summaries with a fixed number of database queries", async () => {
    await seedChatSessionGraph(db, { sessionId: "csess_one", turns: 2 });
    await seedChatSessionGraph(db, { sessionId: "csess_two", turns: 1 });
    let queryCount = 0;
    const queryCounter: KyselyPlugin = {
      transformQuery: ({ node }) => {
        queryCount += 1;
        return node;
      },
      transformResult: async ({ result }) => result,
    };

    const rows = await createChatSessionRepository(db.withPlugin(queryCounter)).list();

    expect(queryCount).toBeLessThanOrEqual(3);
    expect(rows.find((row) => row.id === "csess_one")).toMatchObject({
      last_message_content: "amsg_csess_one_1",
      last_message_at: "2026-07-24T09:01:01.000Z",
      unread_count: 2,
    });
    expect(rows.find((row) => row.id === "csess_two")).toMatchObject({
      last_message_content: "amsg_csess_two_0",
      unread_count: 1,
    });
  });
});

describe("chat session repository deletion", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("deletes the full session graph after recording durable ref cleanup", async () => {
    const seeded = await seedChatSessionGraph(db, { sessionId: TARGET, turns: 2 });
    await seedChatSessionGraph(db, { sessionId: KEEP, turns: 1 });
    await seedRevertOperation(db, {
      id: "crev_delete",
      sessionId: TARGET,
      targetRunId: seeded.runIds[1] as string,
      targetUserMessageId: seeded.userMessageIds[1] as string,
      targetAssistantMessageId: seeded.assistantMessageIds[1] as string,
      targetTurnIndex: 1,
      status: "applied",
      refsToDeleteJson: JSON.stringify([runCheckpointRef(TARGET, "crun_stale", "before")]),
    });
    const repository = createChatSessionRepository(db);

    expect(await repository.delete(TARGET)).toBe(true);

    for (const table of ["chat_sessions", "chat_messages", "chat_runs"] as const) {
      const column = table === "chat_sessions" ? "id" : "session_id";
      expect(
        await db.selectFrom(table).selectAll().where(column, "=", TARGET).execute(),
        table,
      ).toEqual([]);
    }
    for (const runId of seeded.runIds) {
      expect(
        await db.selectFrom("chat_run_events").selectAll().where("run_id", "=", runId).execute(),
      ).toEqual([]);
      expect(
        await db
          .selectFrom("chat_run_changed_files")
          .selectAll()
          .where("run_id", "=", runId)
          .execute(),
      ).toEqual([]);
      expect(
        await db
          .selectFrom("chat_run_checkpoints")
          .selectAll()
          .where("run_id", "=", runId)
          .execute(),
      ).toEqual([]);
    }
    expect(
      await db
        .selectFrom("chat_revert_operations")
        .selectAll()
        .where("session_id", "=", TARGET)
        .execute(),
    ).toEqual([]);

    const jobs = await listCleanupJobs(db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      workspace_path: `/workspace/${TARGET}`,
      worktree_root: `/workspace/${TARGET}`,
      git_common_dir: "/repo/.git",
      status: "pending",
    });
    expect(JSON.parse(jobs[0]?.refs_json ?? "[]")).toEqual([
      runCheckpointRef(TARGET, seeded.runIds[0] as string, "after"),
      runCheckpointRef(TARGET, seeded.runIds[0] as string, "before"),
      runCheckpointRef(TARGET, seeded.runIds[1] as string, "after"),
      runCheckpointRef(TARGET, seeded.runIds[1] as string, "before"),
      runCheckpointRef(TARGET, "crun_stale", "before"),
      revertBackupRef(TARGET, "crev_delete"),
    ]);

    expect(
      await db.selectFrom("chat_sessions").selectAll().where("id", "=", KEEP).execute(),
    ).toHaveLength(1);
  });

  test("does nothing for a missing session", async () => {
    const repository = createChatSessionRepository(db);
    expect(await repository.delete("missing")).toBe(false);
    expect(await listCleanupJobs(db)).toEqual([]);
  });

  test("a first-turn revert whose cleanup already completed needs no new job", async () => {
    const seeded = await seedChatSessionGraph(db, {
      sessionId: TARGET,
      turns: 1,
      withCheckpoints: false,
    });
    await seedRevertOperation(db, {
      id: "crev_done",
      sessionId: TARGET,
      targetRunId: seeded.runIds[0] as string,
      targetUserMessageId: seeded.userMessageIds[0] as string,
      targetAssistantMessageId: seeded.assistantMessageIds[0] as string,
      targetTurnIndex: 0,
      status: "applied",
      cleanupStatus: "completed",
    });

    expect(await createChatSessionRepository(db).delete(TARGET)).toBe(true);
    expect(await listCleanupJobs(db)).toEqual([]);
    expect(await countChatRows(db)).toMatchObject({ chat_sessions: 0, chat_revert_operations: 0 });
  });

  test("groups every distinct workspace identity into its own job", async () => {
    const seeded = await seedChatSessionGraph(db, { sessionId: TARGET, turns: 2 });
    await db
      .updateTable("chat_run_checkpoints")
      .set({ workspace_path: "/workspace/second", worktree_root: "/workspace/second" })
      .where("run_id", "=", seeded.runIds[1] as string)
      .execute();

    expect(await createChatSessionRepository(db).delete(TARGET)).toBe(true);

    const jobs = await listCleanupJobs(db);
    expect(jobs.map((job) => job.workspace_path).sort()).toEqual([
      `/workspace/${TARGET}`,
      "/workspace/second",
    ]);
  });

  test("a pending revert with no matching checkpoint identity leaves every row intact", async () => {
    const seeded = await seedChatSessionGraph(db, {
      sessionId: TARGET,
      turns: 1,
      withCheckpoints: false,
    });
    await seedRevertOperation(db, {
      id: "crev_orphan",
      sessionId: TARGET,
      targetRunId: seeded.runIds[0] as string,
      targetUserMessageId: seeded.userMessageIds[0] as string,
      targetAssistantMessageId: seeded.assistantMessageIds[0] as string,
      targetTurnIndex: 0,
    });
    const before = await countChatRows(db);

    await expect(createChatSessionRepository(db).delete(TARGET)).rejects.toThrow(
      CleanupManifestError,
    );

    expect(await countChatRows(db)).toEqual(before);
    expect(await listCleanupJobs(db)).toEqual([]);
  });

  test("a malformed revert manifest stops the deletion", async () => {
    const seeded = await seedChatSessionGraph(db, { sessionId: TARGET, turns: 1 });
    await seedRevertOperation(db, {
      id: "crev_bad",
      sessionId: TARGET,
      targetRunId: seeded.runIds[0] as string,
      targetUserMessageId: seeded.userMessageIds[0] as string,
      targetAssistantMessageId: seeded.assistantMessageIds[0] as string,
      targetTurnIndex: 0,
      refsToDeleteJson: "{not json",
    });
    const before = await countChatRows(db);

    await expect(createChatSessionRepository(db).delete(TARGET)).rejects.toMatchObject({
      name: CleanupManifestError.name,
      code: "MALFORMED_REFS_JSON",
    });

    expect(await countChatRows(db)).toEqual(before);
    expect(await listCleanupJobs(db)).toEqual([]);
  });

  test("repeated deletion planning reuses the same content-addressed job", async () => {
    await seedChatSessionGraph(db, { sessionId: TARGET, turns: 1 });
    const repository = createChatSessionRepository(db);
    const first = await repository.deleteGraph(TARGET);

    await seedChatSessionGraph(db, { sessionId: TARGET, turns: 1 });
    const second = await repository.deleteGraph(TARGET);

    expect(second.cleanupJobIds).toEqual(first.cleanupJobIds);
    expect(await listCleanupJobs(db)).toHaveLength(1);
  });

  test("a session mutated after preflight cannot be deleted with the stale plan", async () => {
    await seedChatSessionGraph(db, { sessionId: TARGET, turns: 1 });
    const repository = createChatSessionRepository(db);
    const before = await countChatRows(db);

    await expect(
      repository.deleteGraph(TARGET, { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
    ).rejects.toThrow(StaleChatSessionError);

    expect(await countChatRows(db)).toEqual(before);
  });

  test("deletes a session with more runs than one SQLite bind batch", async () => {
    const seeded = await seedChatSessionGraph(db, { sessionId: TARGET, turns: 610 });
    expect(seeded.runIds).toHaveLength(610);

    expect(await createChatSessionRepository(db).delete(TARGET)).toBe(true);

    expect(await countChatRows(db)).toMatchObject({
      chat_sessions: 0,
      chat_messages: 0,
      chat_runs: 0,
      chat_run_events: 0,
      chat_run_changed_files: 0,
      chat_run_checkpoints: 0,
    });
    const jobs = await listCleanupJobs(db);
    expect(JSON.parse(jobs[0]?.refs_json ?? "[]")).toHaveLength(1220);
  }, 60_000);

  test("counts messages per session", async () => {
    const repository = createChatSessionRepository(db);
    await seedChatSessionGraph(db, { sessionId: TARGET, turns: 2 });
    await seedChatSessionGraph(db, { sessionId: KEEP, turns: 1 });

    expect(await repository.countMessages(TARGET)).toBe(4);
    expect(await repository.countMessages(KEEP)).toBe(2);
    expect(await repository.countMessages("csess_empty")).toBe(0);
  });

  test("lists the user messages no run has answered, oldest turn first, and only for that session", async () => {
    const repository = createChatSessionRepository(db);
    await seedChatSessionGraph(db, { sessionId: TARGET, turns: 1 });
    await seedChatSessionGraph(db, { sessionId: KEEP, turns: 1 });
    const waiting = (id: string, sessionId: string, turnIndex: number) =>
      repository.createMessage({
        id,
        session_id: sessionId,
        role: "user",
        content: id,
        action: null,
        activity: null,
        turn_index: turnIndex,
        disposition: "queued",
        created_at: "2026-07-24T10:00:00.000Z",
      });
    await waiting("umsg_late", TARGET, 3);
    await waiting("umsg_early", TARGET, 2);
    await waiting("umsg_other", KEEP, 2);

    const listed = await repository.listWaitingUserMessages(TARGET);

    expect(listed.map((message) => message.id)).toEqual(["umsg_early", "umsg_late"]);
  });

  test("answering messages stores a run for each and releases their queue label", async () => {
    const repository = createChatSessionRepository(db);
    const { runIds } = await seedChatSessionGraph(db, { sessionId: TARGET, turns: 1 });
    await repository.createMessage({
      id: "umsg_waiting",
      session_id: TARGET,
      role: "user",
      content: "umsg_waiting",
      action: null,
      activity: null,
      turn_index: 1,
      disposition: "queued",
      created_at: "2026-07-24T10:00:00.000Z",
    });
    const template = await db
      .selectFrom("chat_runs")
      .selectAll()
      .where("id", "=", runIds[0] ?? "")
      .executeTakeFirstOrThrow();

    await db.transaction().execute((trx) =>
      insertAnsweredRuns(trx, [
        {
          ...template,
          id: "crun_answered",
          user_message_id: "umsg_waiting",
          assistant_message_id: "amsg_unused",
        },
      ]),
    );

    expect(await repository.listWaitingUserMessages(TARGET)).toEqual([]);
    const message = await db
      .selectFrom("chat_messages")
      .select("disposition")
      .where("id", "=", "umsg_waiting")
      .executeTakeFirstOrThrow();
    expect(message.disposition).toBe("immediate");
  });
});
