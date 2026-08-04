import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { ID_BATCH_SIZE } from "../db/batching.ts";
import type { NewChatRunEvent } from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createChatWorkLogRepository } from "./work-log-repository.ts";

describe("chat work-log repository", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("inserts batches idempotently and lists deterministic order", async () => {
    const repository = createChatWorkLogRepository(db);
    await repository.insertMany([
      event("event-2", "run-1", 2, 2),
      event("event-1", "run-1", 1, 1),
      event("event-replay", "run-1", 9, 1),
      event("event-subindex", "run-1", 3, 1, 1),
    ]);

    const rows = await repository.listByRunId("run-1");
    expect(rows.map((row) => row.id)).toEqual(["event-1", "event-2", "event-subindex"]);
    expect(await repository.countByRunIds(["run-1", "run-2"])).toEqual(new Map([["run-1", 3]]));
  });

  test("deletes selected runs and accepts empty batches", async () => {
    const repository = createChatWorkLogRepository(db);
    await repository.insertMany([]);
    await repository.insertMany([event("event-1", "run-1", 1, 1), event("event-2", "run-2", 1, 1)]);

    await repository.deleteByRunIds(["run-1"]);
    await repository.deleteByRunIds([]);

    expect(await repository.listByRunId("run-1")).toEqual([]);
    expect(await repository.listByRunId("run-2")).toHaveLength(1);
  });

  test("inserts, counts, and deletes across multiple batches", async () => {
    const repository = createChatWorkLogRepository(db);
    const runIds = Array.from({ length: ID_BATCH_SIZE + 20 }, (_, index) => `run-${index}`);
    await repository.insertMany(
      runIds.map((runId, index) => event(`event-${index}`, runId, index + 1, index + 1)),
    );

    const counts = await repository.countByRunIds(runIds);
    expect(counts.size).toBe(runIds.length);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);

    await repository.deleteByRunIds(runIds);
    expect(await repository.countByRunIds(runIds)).toEqual(new Map());
  }, 60_000);

  test("replay deduplication holds across insert batch boundaries", async () => {
    const repository = createChatWorkLogRepository(db);
    const total = 400;
    const first = Array.from({ length: total }, (_, index) =>
      event(`event-${index}`, "run-replay", index + 1, index + 1),
    );
    // Same replay keys, different ids: a rerun of the same log must not duplicate.
    const replay = first.map((row, index) => ({ ...row, id: `replay-${index}` }));

    await repository.insertMany(first);
    await repository.insertMany(replay);

    expect(await repository.countByRunIds(["run-replay"])).toEqual(
      new Map([["run-replay", total]]),
    );
    expect((await repository.listByRunId("run-replay")).map((row) => row.id)).toEqual(
      first.map((row) => row.id),
    );
  }, 60_000);
});

const event = (
  id: string,
  runId: string,
  sequence: number,
  sourceIndex: number,
  sourceSubindex = 0,
): NewChatRunEvent => ({
  id,
  run_id: runId,
  sequence,
  source_kind: "fixture",
  source_index: sourceIndex,
  source_subindex: sourceSubindex,
  provider: "fixture",
  kind: "tool",
  phase: "completed",
  status: "completed",
  correlation_id: null,
  title: id,
  summary: null,
  detail: null,
  tool_name: "test",
  tool_kind: "generic",
  input_json: null,
  output_json: null,
  output_text: null,
  exit_code: 0,
  payload_truncated: false,
  occurred_at: null,
  metadata_json: null,
});
