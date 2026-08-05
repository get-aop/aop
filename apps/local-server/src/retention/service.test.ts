import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createRetentionService, RETENTION_DAYS } from "./service.ts";

const OLD_DATE = new Date(Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
const RECENT_DATE = new Date(Date.now() - 60_000).toISOString();

describe("retention/service", () => {
  let cleanupAopHome: (() => void) | undefined;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    cleanupAopHome?.();
    await db.destroy();
  });

  test("prunes old step_logs and runtime_events, keeps recent rows", async () => {
    await db
      .insertInto("step_logs")
      .values([
        { step_execution_id: "step-old", content: "old", created_at: OLD_DATE },
        { step_execution_id: "step-recent", content: "recent", created_at: RECENT_DATE },
      ])
      .execute();
    await db
      .insertInto("runtime_events")
      .values([
        {
          id: "rte-old",
          kind: "assistant_text",
          title: null,
          message: null,
          tool_name: null,
          status: null,
          task_id: "task-old",
          execution_id: "exec-old",
          step_execution_id: "step-old",
          session_id: null,
          agent_id: null,
          source_kind: "step_log",
          source_id: "1",
          source_index: 0,
          occurred_at: OLD_DATE,
          metadata_json: null,
          created_at: OLD_DATE,
        },
        {
          id: "rte-recent",
          kind: "assistant_text",
          title: null,
          message: null,
          tool_name: null,
          status: null,
          task_id: "task-recent",
          execution_id: "exec-recent",
          step_execution_id: "step-recent",
          session_id: null,
          agent_id: null,
          source_kind: "step_log",
          source_id: "2",
          source_index: 0,
          occurred_at: RECENT_DATE,
          metadata_json: null,
          created_at: RECENT_DATE,
        },
      ])
      .execute();

    const service = createRetentionService(ctx);
    const result = await service.runOnce();

    expect(result.deletedStepLogs).toBe(1);
    expect(result.deletedRuntimeEvents).toBe(1);
    const stepLogs = await db.selectFrom("step_logs").select("step_execution_id").execute();
    expect(stepLogs.map((row) => row.step_execution_id)).toEqual(["step-recent"]);
    const events = await db.selectFrom("runtime_events").select("id").execute();
    expect(events.map((row) => row.id)).toEqual(["rte-recent"]);
  });

  test("clears stale chat message activity blobs, keeps recent", async () => {
    await db
      .insertInto("chat_messages")
      .values([
        {
          id: "msg-old",
          session_id: "s1",
          role: "assistant",
          content: "old text",
          activity: JSON.stringify({ thinking: "old run" }),
          created_at: OLD_DATE,
        },
        {
          id: "msg-recent",
          session_id: "s1",
          role: "assistant",
          content: "recent text",
          activity: JSON.stringify({ thinking: "recent run" }),
          created_at: RECENT_DATE,
        },
      ])
      .execute();

    const service = createRetentionService(ctx);
    const result = await service.runOnce();

    expect(result.clearedActivityMessages).toBe(1);
    const oldMessage = await db
      .selectFrom("chat_messages")
      .select(["id", "activity", "content"])
      .where("id", "=", "msg-old")
      .executeTakeFirst();
    const recentMessage = await db
      .selectFrom("chat_messages")
      .select(["id", "activity", "content"])
      .where("id", "=", "msg-recent")
      .executeTakeFirst();
    expect(oldMessage?.activity).toBeNull();
    expect(oldMessage?.content).toBe("old text");
    expect(recentMessage?.activity).not.toBeNull();
  });

  test("removes old transcript files under logs/chat-sessions", async () => {
    const sessionDir = join(aopPaths.logs(), "chat-sessions", "isess_retention");
    mkdirSync(sessionDir, { recursive: true });
    const oldFile = join(sessionDir, "old.jsonl");
    const recentFile = join(sessionDir, "recent.jsonl");
    writeFileSync(oldFile, "line\n");
    writeFileSync(recentFile, "line\n");
    const oldMtime = new Date(Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, oldMtime, oldMtime);

    const service = createRetentionService(ctx);
    const result = await service.runOnce();

    expect(result.removedTranscriptFiles).toBe(1);
    expect(await Bun.file(oldFile).exists()).toBe(false);
    expect(await Bun.file(recentFile).exists()).toBe(true);
  });
});
