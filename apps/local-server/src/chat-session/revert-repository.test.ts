import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { CleanupManifestError } from "./checkpoint-cleanup-manifest.ts";
import { ChatRevertTrimError, createChatRevertRepository } from "./revert-repository.ts";
import {
  countChatRows,
  listCleanupJobs,
  revertBackupRef,
  runCheckpointRef,
  seedChatSessionGraph,
  seedRevertOperation,
} from "./test-utils.ts";

const SESSION = "csess_1";
const OTHER_SESSION = "csess_2";
const OPERATION = "crev_1";
const COMPLETED_AT = "2026-07-24T10:00:00.000Z";

describe("chat revert repository", () => {
  let db: Kysely<Database>;
  let runIds: string[];
  let userMessageIds: string[];
  let assistantMessageIds: string[];

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedChatSessionGraph(db, { sessionId: SESSION, turns: 2 });
    runIds = seeded.runIds;
    userMessageIds = seeded.userMessageIds;
    assistantMessageIds = seeded.assistantMessageIds;
  });

  afterEach(async () => {
    await db.destroy();
  });

  const seedOperation = (
    overrides: Partial<Parameters<typeof seedRevertOperation>[1]> = {},
  ): Promise<void> =>
    seedRevertOperation(db, {
      id: OPERATION,
      sessionId: SESSION,
      targetRunId: runIds[1] as string,
      targetUserMessageId: userMessageIds[1] as string,
      targetAssistantMessageId: assistantMessageIds[1] as string,
      targetTurnIndex: 1,
      ...overrides,
    });

  test("selects a target turn and every later message and run", async () => {
    const repository = createChatRevertRepository(db);
    const selection = await repository.selectTargetAndLater(SESSION, userMessageIds[1] as string);

    expect(selection?.targetRun.id).toBe(runIds[1] as string);
    expect(selection?.targetAssistantMessage?.id).toBe(assistantMessageIds[1] as string);
    expect(selection?.messages.map((message) => message.id)).toEqual([
      userMessageIds[1] as string,
      assistantMessageIds[1] as string,
    ]);
    expect(selection?.runs.map((run) => run.id)).toEqual([runIds[1] as string]);
    expect(
      await repository.selectTargetAndLater(SESSION, assistantMessageIds[1] as string),
    ).toBeNull();
  });

  test("trims the later history graph and records durable cleanup first", async () => {
    await seedOperation();
    const repository = createChatRevertRepository(db);

    const result = await repository.trimHistory({
      operationId: OPERATION,
      completedAt: COMPLETED_AT,
    });

    expect(result).toMatchObject({
      sessionId: SESSION,
      targetTurnIndex: 1,
      removedMessageCount: 2,
      removedRunCount: 1,
    });
    expect(result.cleanupJobIds).toHaveLength(1);
    expect(await remainingIds(db, "chat_messages", "id")).toEqual([
      userMessageIds[0] as string,
      assistantMessageIds[0] as string,
    ]);
    expect(await remainingIds(db, "chat_runs", "id")).toEqual([runIds[0] as string]);
    expect(
      await db
        .selectFrom("chat_run_checkpoints")
        .selectAll()
        .where("run_id", "=", runIds[1] as string)
        .execute(),
    ).toEqual([]);

    // The job exists with the refs of the now-deleted checkpoint, which is only
    // possible if it was written while those rows were still readable.
    const [job] = await listCleanupJobs(db);
    expect(job?.status).toBe("pending");
    expect(job?.id).toBe(result.cleanupJobIds[0] as string);
    expect(JSON.parse(job?.refs_json ?? "[]")).toEqual([
      runCheckpointRef(SESSION, runIds[1] as string, "after"),
      runCheckpointRef(SESSION, runIds[1] as string, "before"),
      revertBackupRef(SESSION, OPERATION),
    ]);
    expect(JSON.parse(job?.session_ids_json ?? "[]")).toEqual([SESSION]);

    const operation = await loadOperation(db);
    expect(operation.status).toBe("applied");
    expect(operation.cleanup_status).toBe("pending");
    expect(await repository.listNeedingRecoveryOrCleanup()).toHaveLength(1);
  });

  test("groups refs by every exact workspace identity", async () => {
    await db
      .updateTable("chat_run_checkpoints")
      .set({ workspace_path: "/workspace/other", worktree_root: "/workspace/other" })
      .where("run_id", "=", runIds[1] as string)
      .execute();
    await seedOperation();

    const result = await createChatRevertRepository(db).trimHistory({
      operationId: OPERATION,
      completedAt: COMPLETED_AT,
    });

    // Only the target turn's checkpoint is trimmed, so exactly one identity is used.
    const jobs = await listCleanupJobs(db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.workspace_path).toBe("/workspace/other");
    expect(result.cleanupJobIds).toEqual([jobs[0]?.id as string]);
  });

  test("rejects a missing, mismatched, or already-applied operation without changing rows", async () => {
    const repository = createChatRevertRepository(db);
    const before = await countChatRows(db);

    await expectTrimError(repository, "OPERATION_NOT_FOUND");

    await seedOperation({ status: "applied" });
    await expectTrimError(repository, "OPERATION_STATUS_MISMATCH");
    await db.deleteFrom("chat_revert_operations").execute();

    await seedOperation({ status: "rolled_back" });
    await expectTrimError(repository, "OPERATION_STATUS_MISMATCH");
    await db.deleteFrom("chat_revert_operations").execute();

    await seedOperation({ status: "failed" });
    await expectTrimError(repository, "OPERATION_STATUS_MISMATCH");
    await db.deleteFrom("chat_revert_operations").execute();

    expect(await countChatRows(db)).toMatchObject({ ...before, chat_revert_operations: 0 });
    expect(await listCleanupJobs(db)).toEqual([]);
  });

  test("rejects an operation whose target belongs to another session", async () => {
    await seedChatSessionGraph(db, { sessionId: OTHER_SESSION, turns: 1 });
    await seedRevertOperation(db, {
      id: OPERATION,
      sessionId: OTHER_SESSION,
      targetRunId: runIds[1] as string,
      targetUserMessageId: userMessageIds[1] as string,
      targetAssistantMessageId: assistantMessageIds[1] as string,
      targetTurnIndex: 1,
      targetCheckpointRef: runCheckpointRef(OTHER_SESSION, runIds[1] as string, "before"),
    });

    await expectTrimError(createChatRevertRepository(db), "TARGET_MESSAGE_MISMATCH");
    expect(await countChatRows(db)).toMatchObject({ chat_messages: 6, chat_runs: 3 });
  });

  test("rejects an operation whose stored turn no longer matches the target message", async () => {
    await seedOperation({ targetTurnIndex: 0 });
    await expectTrimError(createChatRevertRepository(db), "TARGET_MESSAGE_MISMATCH");
    expect(await listCleanupJobs(db)).toEqual([]);
  });

  test("rejects an operation whose stored run no longer matches the target message", async () => {
    await seedOperation({ targetRunId: runIds[0] as string });
    await expectTrimError(createChatRevertRepository(db), "TARGET_RUN_MISMATCH");
    expect(await listCleanupJobs(db)).toEqual([]);
  });

  test("a repeated apply attempt is rejected and leaves the applied state intact", async () => {
    await seedOperation();
    const repository = createChatRevertRepository(db);
    await repository.trimHistory({ operationId: OPERATION, completedAt: COMPLETED_AT });
    const after = await countChatRows(db);

    await expectTrimError(repository, "OPERATION_STATUS_MISMATCH");

    expect(await countChatRows(db)).toEqual(after);
    expect((await loadOperation(db)).status).toBe("applied");
    expect(await listCleanupJobs(db)).toHaveLength(1);
  });

  test("rolls the whole transaction back when a cleanup manifest is rejected", async () => {
    const cases: Array<[string, string]> = [
      ["malformed refs_to_delete_json", "{not json"],
      ["cross-session ref", JSON.stringify([runCheckpointRef(OTHER_SESSION, "crun_x", "before")])],
      ["cross-operation backup ref", JSON.stringify([revertBackupRef(SESSION, "crev_other")])],
      ["ref outside the checkpoint namespace", JSON.stringify(["refs/heads/main"])],
    ];

    for (const [label, refsToDeleteJson] of cases) {
      await seedOperation({ refsToDeleteJson });
      const before = await countChatRows(db);

      await expect(
        createChatRevertRepository(db).trimHistory({
          operationId: OPERATION,
          completedAt: COMPLETED_AT,
        }),
        label,
      ).rejects.toThrow(CleanupManifestError);

      expect(await countChatRows(db), label).toEqual(before);
      expect(await listCleanupJobs(db), label).toEqual([]);
      expect((await loadOperation(db)).status, label).toBe("applying");
      await db.deleteFrom("chat_revert_operations").execute();
    }
  });

  test("rejects a cross-run target checkpoint ref", async () => {
    await seedOperation({
      targetCheckpointRef: runCheckpointRef(SESSION, runIds[0] as string, "before"),
    });

    await expect(
      createChatRevertRepository(db).trimHistory({
        operationId: OPERATION,
        completedAt: COMPLETED_AT,
      }),
    ).rejects.toThrow(CleanupManifestError);
    expect(await listCleanupJobs(db)).toEqual([]);
  });

  test("aborts when an operation ref has no exact workspace identity", async () => {
    await db
      .deleteFrom("chat_run_checkpoints")
      .where("run_id", "=", runIds[1] as string)
      .execute();
    await seedOperation();
    const before = await countChatRows(db);

    await expect(
      createChatRevertRepository(db).trimHistory({
        operationId: OPERATION,
        completedAt: COMPLETED_AT,
      }),
    ).rejects.toThrow(/MISSING_WORKSPACE_IDENTITY|exact workspace identity/);

    expect(await countChatRows(db)).toEqual(before);
    expect(await listCleanupJobs(db)).toEqual([]);
  });

  test("trims a session with more runs than one SQLite bind batch", async () => {
    const bulkSession = "csess_bulk";
    const seeded = await seedChatSessionGraph(db, { sessionId: bulkSession, turns: 520 });
    await seedRevertOperation(db, {
      id: "crev_bulk",
      sessionId: bulkSession,
      targetRunId: seeded.runIds[1] as string,
      targetUserMessageId: seeded.userMessageIds[1] as string,
      targetAssistantMessageId: seeded.assistantMessageIds[1] as string,
      targetTurnIndex: 1,
    });

    const result = await createChatRevertRepository(db).trimHistory({
      operationId: "crev_bulk",
      completedAt: COMPLETED_AT,
    });

    expect(result.removedRunCount).toBe(519);
    expect(result.removedMessageCount).toBe(1038);
    expect(
      await db.selectFrom("chat_runs").select("id").where("session_id", "=", bulkSession).execute(),
    ).toHaveLength(1);
    const jobs = await listCleanupJobs(db);
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0]?.refs_json ?? "[]")).toHaveLength(519 * 2 + 1);
  }, 60_000);
});

const expectTrimError = async (
  repository: ReturnType<typeof createChatRevertRepository>,
  code: string,
): Promise<void> => {
  await expect(
    repository.trimHistory({ operationId: OPERATION, completedAt: COMPLETED_AT }),
  ).rejects.toMatchObject({ name: ChatRevertTrimError.name, code });
};

const loadOperation = (database: Kysely<Database>) =>
  database
    .selectFrom("chat_revert_operations")
    .selectAll()
    .where("id", "=", OPERATION)
    .executeTakeFirstOrThrow();

const remainingIds = async (
  database: Kysely<Database>,
  table: "chat_messages" | "chat_runs",
  column: "id",
): Promise<string[]> =>
  (
    await database.selectFrom(table).select(column).orderBy("created_at").orderBy("id").execute()
  ).map((row) => row.id);
