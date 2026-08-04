import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { NewChatCheckpointCleanupJob } from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import {
  type ChatCheckpointCleanupRepository,
  createChatCheckpointCleanupRepository,
} from "./checkpoint-cleanup-repository.ts";
import { runCheckpointRef } from "./test-utils.ts";

const NOW = "2026-07-24T10:00:00.000Z";
const LATER = "2026-07-24T10:05:00.000Z";
const STALE_CUTOFF = "2026-07-24T09:59:00.000Z";

describe("chat checkpoint cleanup repository", () => {
  let db: Kysely<Database>;
  let repository: ChatCheckpointCleanupRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repository = createChatCheckpointCleanupRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates jobs idempotently and lists unfinished work in deterministic order", async () => {
    await repository.create(job("cleanup_1"));
    await repository.createMany([job("cleanup_2"), job("cleanup_1")]);
    await repository.createMany([job("cleanup_1")]);

    expect((await repository.listUnfinished()).map((row) => row.id)).toEqual([
      "cleanup_1",
      "cleanup_2",
    ]);
    expect(await db.selectFrom("chat_checkpoint_cleanup_jobs").selectAll().execute()).toHaveLength(
      2,
    );
  });

  test("only one worker wins a contested claim", async () => {
    await repository.create(job("cleanup_1"));

    const [first, second] = await Promise.all([
      repository.claim({ token: "worker-a", now: NOW, staleBefore: STALE_CUTOFF }),
      repository.claim({ token: "worker-b", now: NOW, staleBefore: STALE_CUTOFF }),
    ]);

    expect(first.length + second.length).toBe(1);
    const claimed = [...first, ...second][0];
    expect(claimed?.status).toBe("processing");
    expect(claimed?.attempts).toBe(1);
  });

  test("recovers a claim abandoned by a crashed worker", async () => {
    await repository.create(job("cleanup_1"));
    const first = await repository.claim({
      token: "crashed",
      now: NOW,
      staleBefore: STALE_CUTOFF,
    });
    expect(first).toHaveLength(1);

    // The lease has not expired yet, so the job stays with the crashed worker.
    expect(
      await repository.claim({ token: "fresh", now: LATER, staleBefore: STALE_CUTOFF }),
    ).toHaveLength(0);

    const recovered = await repository.claim({ token: "fresh", now: LATER, staleBefore: LATER });
    expect(recovered.map((row) => row.id)).toEqual(["cleanup_1"]);
    expect(recovered[0]?.attempts).toBe(2);
    expect(await repository.markCompleted("cleanup_1", "crashed", LATER)).toBe(false);
    expect(await repository.markCompleted("cleanup_1", "fresh", LATER)).toBe(true);
  });

  test("a late worker cannot regress a completed job", async () => {
    await repository.create(job("cleanup_1"));
    const [claimed] = await repository.claim({
      token: "worker-a",
      now: NOW,
      staleBefore: STALE_CUTOFF,
    });
    expect(claimed?.claim_token).toBe("worker-a");
    expect(await repository.markCompleted("cleanup_1", "worker-a", LATER)).toBe(true);

    expect(await repository.markFailed("cleanup_1", "worker-a", "too late", LATER)).toBe(false);
    expect(await repository.markCompleted("cleanup_1", "worker-a", LATER)).toBe(false);

    const [row] = await repository.listByIds(["cleanup_1"]);
    expect(row?.status).toBe("completed");
    expect(row?.completed_at).toBe(LATER);
    expect(await repository.listUnfinished()).toEqual([]);
  });

  test("failure clears a stale completion timestamp and stays retryable", async () => {
    await repository.create(job("cleanup_1"));
    const [claimed] = await repository.claim({
      token: "worker-a",
      now: NOW,
      staleBefore: STALE_CUTOFF,
    });
    expect(claimed).toBeDefined();
    await repository.markCompleted("cleanup_1", "worker-a", LATER);

    // Reopen the job the way a re-planned deletion would, then fail the retry.
    await db
      .updateTable("chat_checkpoint_cleanup_jobs")
      .set({ status: "pending" })
      .where("id", "=", "cleanup_1")
      .execute();
    const [retry] = await repository.claim({
      token: "worker-b",
      now: LATER,
      staleBefore: STALE_CUTOFF,
    });
    expect(retry?.completed_at).toBeNull();
    expect(await repository.markFailed("cleanup_1", "worker-b", "git failed", LATER)).toBe(true);

    const [row] = await repository.listByIds(["cleanup_1"]);
    expect(row?.status).toBe("failed");
    expect(row?.completed_at).toBeNull();
    expect(row?.error_message).toBe("git failed");
    expect((await repository.listUnfinished()).map((item) => item.id)).toEqual(["cleanup_1"]);
  });

  test("claims can be scoped to a known job set", async () => {
    await repository.createMany([job("cleanup_1"), job("cleanup_2")]);

    const claimed = await repository.claim({
      token: "worker-a",
      now: NOW,
      staleBefore: STALE_CUTOFF,
      ids: ["cleanup_2"],
    });

    expect(claimed.map((row) => row.id)).toEqual(["cleanup_2"]);
    expect(await repository.claim({ token: "w", now: NOW, staleBefore: NOW, ids: [] })).toEqual([]);
  });

  test("persists cleanup jobs across multiple insert batches", async () => {
    const jobs = Array.from({ length: 260 }, (_, index) => job(`cleanup_${index}`));
    await repository.createMany(jobs);

    expect(await repository.listByIds(jobs.map((row) => row.id))).toHaveLength(260);
    expect(await repository.listUnfinished()).toHaveLength(260);
  });
});

const job = (id: string): NewChatCheckpointCleanupJob => ({
  id,
  workspace_path: `/workspace/${id}`,
  worktree_root: `/workspace/${id}`,
  git_common_dir: "/repo/.git",
  refs_json: JSON.stringify([runCheckpointRef("csess_1", "crun_1", "before")]),
  session_ids_json: JSON.stringify(["csess_1"]),
  status: "pending",
  error_message: null,
  claim_token: null,
  claimed_at: null,
  attempts: 0,
  created_at: NOW,
  updated_at: NOW,
  completed_at: null,
});
