import { afterEach, describe, expect, test } from "bun:test";
import { access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ChatDelegationRun,
  parseChatDelegationRuns,
  serializeChatDelegationRuns,
} from "@aop/common";
import { createCommandContext } from "../context.ts";
import { createTestDb } from "../db/test-utils.ts";
import {
  BACKGROUND_TASK_CLEANUP_INTERVAL_MS,
  pruneOldBackgroundTasks,
} from "./background-task-retention.ts";

const databases: Array<Awaited<ReturnType<typeof createTestDb>>> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

describe("background task retention", () => {
  test("uses a five-minute cleanup interval", () => {
    expect(BACKGROUND_TASK_CLEANUP_INTERVAL_MS).toBe(300_000);
  });

  test("keeps the five newest background tasks per session", async () => {
    const db = await createTestDb();
    databases.push(db);
    const ctx = createCommandContext(db);
    const sessionA = "isess_retention_a";
    const sessionB = "isess_retention_b";
    await addSession(ctx, sessionA);
    await addSession(ctx, sessionB);

    const oldestLog = join(tmpdir(), `aop-old-background-${crypto.randomUUID()}.jsonl`);
    await writeFile(oldestLog, "old");
    await addRun(ctx, sessionA, "crun_retention_a1", [
      backgroundTask("bg_1", "2026-07-01T10:01:00.000Z", oldestLog),
      delegation("delegation_1", "2026-07-01T10:01:30.000Z"),
      backgroundTask("bg_2", "2026-07-01T10:02:00.000Z"),
    ]);
    await addRun(ctx, sessionA, "crun_retention_a2", [
      backgroundTask("bg_3", "2026-07-01T10:03:00.000Z"),
      backgroundTask("bg_4", "2026-07-01T10:04:00.000Z"),
      backgroundTask("bg_5", "2026-07-01T10:05:00.000Z"),
      backgroundTask("bg_6", "2026-07-01T10:06:00.000Z"),
    ]);
    await addRun(ctx, sessionB, "crun_retention_b1", [
      backgroundTask("other_1", "2026-07-01T10:01:00.000Z"),
      backgroundTask("other_2", "2026-07-01T10:02:00.000Z"),
      backgroundTask("other_3", "2026-07-01T10:03:00.000Z"),
      backgroundTask("other_4", "2026-07-01T10:04:00.000Z"),
      backgroundTask("other_5", "2026-07-01T10:05:00.000Z"),
      backgroundTask("other_6", "2026-07-01T10:06:00.000Z"),
    ]);

    expect(await pruneOldBackgroundTasks(ctx, sessionA)).toBe(1);
    expect(await backgroundTaskIds(ctx, sessionA)).toEqual([
      "bg_2",
      "bg_3",
      "bg_4",
      "bg_5",
      "bg_6",
    ]);
    expect(await delegationIds(ctx, sessionA)).toEqual(["delegation_1"]);
    expect(await backgroundTaskIds(ctx, sessionB)).toHaveLength(6);
    expect(
      await access(oldestLog)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);

    expect(await pruneOldBackgroundTasks(ctx)).toBe(1);
    expect(await backgroundTaskIds(ctx, sessionB)).toEqual([
      "other_2",
      "other_3",
      "other_4",
      "other_5",
      "other_6",
    ]);
  });
});

const addSession = async (
  ctx: ReturnType<typeof createCommandContext>,
  id: string,
): Promise<void> => {
  const now = new Date().toISOString();
  await ctx.chatSessionRepository.create({
    id,
    repo_id: null,
    title: id,
    named: false,
    runtime: "claude-code",
    runtime_configuration_id: null,
    model: "claude-opus-4-8",
    reasoning_effort: "medium",
    runtime_alias: null,
    runtime_session_id: null,
    workspace_path: "/tmp",
    fast_mode: false,
    default_worker_id: null,
    default_workflow_id: null,
    pinned: false,
    settled_override: null,
    settled_at: null,
    created_at: now,
    updated_at: now,
  });
};

const addRun = async (
  ctx: ReturnType<typeof createCommandContext>,
  sessionId: string,
  runId: string,
  entries: ChatDelegationRun[],
): Promise<void> => {
  const now = new Date().toISOString();
  await ctx.db
    .insertInto("chat_messages")
    .values({
      id: `${runId}_user`,
      session_id: sessionId,
      role: "user",
      content: "test",
      action: null,
      turn_index: 1,
      disposition: "immediate",
      created_at: now,
    })
    .execute();
  await ctx.db
    .insertInto("chat_runs")
    .values({
      id: runId,
      session_id: sessionId,
      user_message_id: `${runId}_user`,
      assistant_message_id: `${runId}_assistant`,
      runtime: "claude-code",
      log_file_path: "",
      status: "completed",
      runtime_session_id: null,
      resume_session_id: null,
      failure_kind: null,
      interruption_kind: null,
      context_strategy: "native_resume",
      workspace_path: "/tmp",
      timeout_policy: null,
      retry_of_run_id: null,
      runtime_session_state: null,
      error_message: null,
      delegation_runs: serializeChatDelegationRuns(entries),
      created_at: now,
      updated_at: now,
    })
    .execute();
};

const backgroundTask = (id: string, startedAt: string, logFilePath = ""): ChatDelegationRun => ({
  id,
  kind: "background-task",
  label: id,
  runtime: "claude-code",
  runtimeAlias: null,
  runtimeConfigurationId: null,
  model: "claude-opus-4-8",
  reasoning: "medium",
  fastMode: false,
  status: "completed",
  activity: "Completed",
  runtimeSessionId: null,
  logFilePath,
  error: null,
  toolUseId: `tool_${id}`,
  startedAt,
  updatedAt: startedAt,
});

const delegation = (id: string, startedAt: string): ChatDelegationRun => ({
  ...backgroundTask(id, startedAt),
  kind: "delegation",
  toolUseId: undefined,
});

const entriesForSession = async (
  ctx: ReturnType<typeof createCommandContext>,
  sessionId: string,
): Promise<ChatDelegationRun[]> => {
  const rows = await ctx.db
    .selectFrom("chat_runs")
    .select("delegation_runs")
    .where("session_id", "=", sessionId)
    .execute();
  return rows.flatMap((row) => parseChatDelegationRuns(row.delegation_runs));
};

const backgroundTaskIds = async (
  ctx: ReturnType<typeof createCommandContext>,
  sessionId: string,
): Promise<string[]> =>
  (await entriesForSession(ctx, sessionId))
    .filter((entry) => entry.kind === "background-task")
    .map((entry) => entry.id)
    .sort();

const delegationIds = async (
  ctx: ReturnType<typeof createCommandContext>,
  sessionId: string,
): Promise<string[]> =>
  (await entriesForSession(ctx, sessionId))
    .filter((entry) => entry.kind === "delegation")
    .map((entry) => entry.id)
    .sort();
