import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { CleanupManifestError } from "./checkpoint-cleanup-manifest.ts";
import { createChatSessionRepository } from "./repository.ts";
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
});
