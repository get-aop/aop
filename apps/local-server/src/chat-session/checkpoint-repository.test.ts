import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { ID_BATCH_SIZE } from "../db/batching.ts";
import type { NewChatRunCheckpoint } from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import {
  ChatCheckpointStateError,
  createChatCheckpointRepository,
} from "./checkpoint-repository.ts";
import { runCheckpointRef } from "./test-utils.ts";

const SESSION = "csess_checkpoints";

const baseCheckpoint = (runId: string): NewChatRunCheckpoint => ({
  run_id: runId,
  workspace_path: "/workspace",
  worktree_root: "/workspace",
  git_common_dir: "/repo/.git",
  branch: "feature",
  head_oid: "head-1",
  before_ref: runCheckpointRef(SESSION, runId, "before"),
  after_ref: runCheckpointRef(SESSION, runId, "after"),
  before_oid: null,
  after_oid: null,
  before_status: "pending",
  after_status: "pending",
  before_error: null,
  after_error: null,
});

describe("chat checkpoint repository", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates, adopts, updates, and bulk loads checkpoints", async () => {
    const repository = createChatCheckpointRepository(db);
    const checkpoint = await repository.create({
      run_id: "crun_1",
      workspace_path: "/workspace",
      worktree_root: "/workspace",
      git_common_dir: "/repo/.git",
      branch: "feature",
      head_oid: "head-1",
      before_ref: runCheckpointRef(SESSION, "crun_1", "before"),
      after_ref: runCheckpointRef(SESSION, "crun_1", "after"),
      before_oid: null,
      after_oid: null,
      before_status: "pending",
      after_status: "pending",
      before_error: null,
      after_error: null,
    });
    const adopted = await repository.create({ ...checkpoint, branch: "ignored" });
    expect(adopted.branch).toBe("feature");

    const updated = await repository.updateBeforeCapture("crun_1", {
      status: "ready",
      oid: "before-1",
      error: null,
      updatedAt: "2026-07-24T10:00:00.000Z",
    });
    expect(updated?.before_status).toBe("ready");
    expect(updated?.before_oid).toBe("before-1");
    expect(await repository.listByRunIds([])).toEqual([]);
    expect(await repository.listRefsByRunIds(["crun_1"])).toHaveLength(1);
  });

  test("keeps refs canonical and capture status consistent with the stored commit", async () => {
    const repository = createChatCheckpointRepository(db);

    await expect(
      repository.create({
        ...baseCheckpoint("crun_bad"),
        before_ref: "refs/aop/chat-checkpoints/crun_bad/before",
      }),
    ).rejects.toThrow(ChatCheckpointStateError);
    await expect(
      repository.create({
        ...baseCheckpoint("crun_bad"),
        after_ref: runCheckpointRef(SESSION, "crun_other", "after"),
      }),
    ).rejects.toThrow(ChatCheckpointStateError);
    expect(await db.selectFrom("chat_run_checkpoints").selectAll().execute()).toEqual([]);

    await repository.create(baseCheckpoint("crun_1"));
    await expect(
      repository.updateBeforeCapture("crun_1", {
        status: "ready",
        oid: null,
        error: null,
        updatedAt: "2026-07-24T10:00:00.000Z",
      }),
    ).rejects.toThrow(/cannot be ready without a captured commit/);
    await expect(
      repository.updateAfterCapture("crun_1", {
        status: "failed",
        oid: "after-1",
        error: "boom",
        updatedAt: "2026-07-24T10:00:00.000Z",
      }),
    ).rejects.toThrow(/must not carry a commit/);

    expect(await repository.getByRunId("crun_1")).toMatchObject({
      before_status: "pending",
      before_oid: null,
      after_status: "pending",
      after_oid: null,
    });
  });

  test("atomically replaces and bulk loads changed-file summaries", async () => {
    const repository = createChatCheckpointRepository(db);
    await repository.replaceChangedFiles("crun_1", [
      {
        path: "src/a.ts",
        old_path: null,
        status: "modified",
        additions: 3,
        deletions: 1,
        binary: false,
      },
      {
        path: "src/b.ts",
        old_path: "src/old.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        binary: false,
      },
    ]);
    await repository.replaceChangedFiles("crun_1", [
      {
        path: "src/final.ts",
        old_path: null,
        status: "added",
        additions: 4,
        deletions: 0,
        binary: false,
      },
    ]);

    expect((await repository.listChangedFiles("crun_1")).map((file) => file.path)).toEqual([
      "src/final.ts",
    ]);
    expect(await repository.listChangedFilesByRunIds(["crun_1", "crun_2"])).toHaveLength(1);
  });

  test("bulk reads cross the SQLite bind-parameter batch boundary", async () => {
    const repository = createChatCheckpointRepository(db);
    const runIds = Array.from(
      { length: ID_BATCH_SIZE + 25 },
      (_, index) => `crun_${String(index).padStart(4, "0")}`,
    );
    for (const runId of runIds) {
      await repository.create({
        run_id: runId,
        workspace_path: "/workspace",
        worktree_root: "/workspace",
        git_common_dir: "/repo/.git",
        branch: null,
        head_oid: null,
        before_ref: runCheckpointRef(SESSION, runId, "before"),
        after_ref: runCheckpointRef(SESSION, runId, "after"),
        before_oid: null,
        after_oid: null,
        before_status: "pending",
        after_status: "pending",
        before_error: null,
        after_error: null,
      });
      await repository.replaceChangedFiles(runId, [
        {
          path: "a.ts",
          old_path: null,
          status: "modified",
          additions: 1,
          deletions: 0,
          binary: false,
        },
      ]);
    }

    const checkpoints = await repository.listByRunIds(runIds);
    expect(checkpoints).toHaveLength(runIds.length);
    expect(checkpoints.map((row) => row.run_id)).toEqual([...runIds].sort());
    expect(await repository.listChangedFilesByRunIds(runIds)).toHaveLength(runIds.length);
  }, 60_000);

  test("atomic changed-file replacement exceeds one insert batch", async () => {
    const repository = createChatCheckpointRepository(db);
    const files = Array.from({ length: 400 }, (_, index) => ({
      path: `src/file-${String(index).padStart(4, "0")}.ts`,
      old_path: null,
      status: "modified" as const,
      additions: index,
      deletions: 0,
      binary: false,
    }));

    await repository.replaceChangedFiles("crun_bulk", files);
    expect(await repository.listChangedFiles("crun_bulk")).toHaveLength(400);

    await repository.replaceChangedFiles("crun_bulk", files.slice(0, 3));
    expect((await repository.listChangedFiles("crun_bulk")).map((file) => file.path)).toEqual(
      files.slice(0, 3).map((file) => file.path),
    );
  }, 60_000);
});
