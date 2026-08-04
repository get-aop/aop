import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { consumeSignalAsDraftTask, createSignal, listSignals } from "./service.ts";

describe("signals service", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/repo-1");
    await createTestTask(db, "task-1", "repo-1", "docs/tasks/task-1", "DONE");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates and lists unconsumed signals", async () => {
    const signal = await createSignal(ctx, {
      repoId: "repo-1",
      sourceTaskId: "task-1",
      kind: "docs-gap",
      title: "Document setup steps",
      body: "The task revealed missing setup documentation.",
      provenance: "aop",
      confidence: "medium",
    });

    const signals = await listSignals(ctx, { repoId: "repo-1", openOnly: true });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ id: signal.id, consumedAt: null, title: signal.title });
  });

  test("consumes a signal into exactly one DRAFT task", async () => {
    const signal = await createSignal(ctx, {
      repoId: "repo-1",
      sourceTaskId: "task-1",
      kind: "follow-up",
      title: "Add regression coverage",
      body: "Create tests for the edge case discovered by task-1.",
      provenance: "aop",
      confidence: "high",
    });

    const first = await consumeSignalAsDraftTask(ctx, signal.id);
    const second = await consumeSignalAsDraftTask(ctx, signal.id);

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    if (!first.success) throw new Error("Expected signal consumption to succeed");
    expect(first.task.status).toBe("DRAFT");
    const consumed = await listSignals(ctx, { openOnly: false });
    expect(consumed[0]?.consumedTaskId).toBe(first.task.id);
    expect(consumed[0]?.consumedAt).toBeTruthy();
  });
});
