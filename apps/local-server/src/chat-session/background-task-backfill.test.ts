import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ChatDelegationRun,
  parseChatDelegationRuns,
  serializeChatDelegationRuns,
} from "@aop/common";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import { createTestDb } from "../db/test-utils.ts";
import {
  backfillBackgroundTasksFromLogs,
  mergeBackgroundTasksFromProgress,
} from "./background-task-backfill.ts";
import { listChatDelegations } from "./delegation-runs.ts";
import type { StreamProgressSnapshot } from "./stream-progress.ts";

const databases: Array<Awaited<ReturnType<typeof createTestDb>>> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

describe("mergeBackgroundTasksFromProgress", () => {
  test("appends missing Task/Agent rows as completed background tasks", () => {
    const progress = snapshot({
      commandGroups: [
        {
          id: "cg_1",
          commands: [
            {
              id: "toolu_old",
              command: "Task",
              detail: "Explore UI",
              result: "Found cards",
              status: "done",
              exitCode: 0,
            },
          ],
        },
      ],
    });
    const { entries, added } = mergeBackgroundTasksFromProgress([], progress, hostMeta());
    expect(added).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "background-task",
      label: "Explore UI",
      toolUseId: "toolu_old",
      status: "completed",
      activity: "Completed",
    });
    expect(added[0]?.content).toContain("Found cards");
  });

  test("does not duplicate toolUseIds already present", () => {
    const progress = snapshot({
      commandGroups: [
        {
          id: "cg_1",
          commands: [
            { id: "toolu_1", command: "Agent", detail: "Search", status: "done", exitCode: 0 },
          ],
        },
      ],
    });
    const first = mergeBackgroundTasksFromProgress([], progress, hostMeta());
    const second = mergeBackgroundTasksFromProgress(first.entries, progress, hostMeta());
    expect(second.added).toHaveLength(0);
    expect(second.entries).toHaveLength(1);
  });

  test("marks unfinished tools cancelled when the host was interrupted", () => {
    const progress = snapshot({
      commandGroups: [
        {
          id: "cg_1",
          commands: [{ id: "toolu_1", command: "Task", detail: "Still going", status: "running" }],
        },
      ],
    });
    const { entries } = mergeBackgroundTasksFromProgress([], progress, {
      ...hostMeta(),
      hostRunStatus: "interrupted",
    });
    expect(entries[0]?.status).toBe("cancelled");
  });
});

describe("backfillBackgroundTasksFromLogs", () => {
  test("reconstructs background tasks from a historical host log", async () => {
    const { ctx, sessionId, runId, logFilePath } = await setupWithLog([
      {
        type: "assistant",
        message: {
          content: [
            {
              id: "toolu_hist_1",
              type: "tool_use",
              name: "Task",
              input: { description: "Historical explore" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_hist_1",
              content: "Backfill result body",
            },
          ],
        },
      },
    ]);

    const added = await backfillBackgroundTasksFromLogs(ctx, { sessionId });
    expect(added).toBe(1);

    const stored = await delegationRunsOf(ctx, runId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.kind).toBe("background-task");
    expect(stored[0]?.label).toBe("Historical explore");
    expect(stored[0]?.status).toBe("completed");
    expect(stored[0]?.toolUseId).toBe("toolu_hist_1");
    expect(stored[0]?.logFilePath).toBeTruthy();

    // Idempotent second pass.
    expect(await backfillBackgroundTasksFromLogs(ctx, { sessionId })).toBe(0);

    // listChatDelegations session scope returns them (and re-backfills safely).
    const listed = await listChatDelegations(ctx, sessionId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.label).toBe("Historical explore");

    void logFilePath;
  });

  test("reconstructs only the five most recent background tasks", async () => {
    const { ctx, sessionId, runId } = await setupWithLog(backgroundTaskEvents(6));

    expect(await backfillBackgroundTasksFromLogs(ctx, { sessionId })).toBe(5);
    const stored = await delegationRunsOf(ctx, runId);
    expect(stored.map((entry) => entry.label)).toEqual([
      "Historical task 2",
      "Historical task 3",
      "Historical task 4",
      "Historical task 5",
      "Historical task 6",
    ]);
    expect(await backfillBackgroundTasksFromLogs(ctx, { sessionId })).toBe(0);
  });

  test("replaces an older persisted task with a newer task from the log", async () => {
    const { ctx, sessionId, runId } = await setupWithLog(backgroundTaskEvents(1));
    const oldTasks = Array.from({ length: 5 }, (_, index) => persistedBackgroundTask(index + 1));
    await ctx.db
      .updateTable("chat_runs")
      .set({ delegation_runs: serializeChatDelegationRuns(oldTasks) })
      .where("id", "=", runId)
      .execute();

    expect(await backfillBackgroundTasksFromLogs(ctx, { sessionId })).toBe(1);
    const stored = await delegationRunsOf(ctx, runId);
    expect(stored.map((entry) => entry.label)).toEqual([
      "Persisted task 2",
      "Persisted task 3",
      "Persisted task 4",
      "Persisted task 5",
      "Historical task 1",
    ]);
    expect(await backfillBackgroundTasksFromLogs(ctx, { sessionId })).toBe(0);
  });

  test("ignores host logs without Task/Agent tools", async () => {
    const { ctx, sessionId } = await setupWithLog([
      {
        type: "assistant",
        message: {
          content: [{ id: "toolu_bash", type: "tool_use", name: "Bash", input: { command: "ls" } }],
        },
      },
    ]);
    expect(await backfillBackgroundTasksFromLogs(ctx, { sessionId })).toBe(0);
  });
});

const persistedBackgroundTask = (index: number): ChatDelegationRun => {
  const timestamp = `2026-01-0${index}T10:00:00.000Z`;
  return {
    id: `del_persisted_${index}`,
    kind: "background-task",
    label: `Persisted task ${index}`,
    runtime: "claude-code",
    runtimeAlias: null,
    runtimeConfigurationId: null,
    model: "claude-opus-4-8",
    reasoning: "medium",
    fastMode: false,
    status: "completed",
    activity: "Completed",
    runtimeSessionId: null,
    logFilePath: "",
    error: null,
    toolUseId: `toolu_persisted_${index}`,
    startedAt: timestamp,
    updatedAt: timestamp,
  };
};

const backgroundTaskEvents = (count: number): unknown[] => [
  {
    type: "assistant",
    message: {
      content: Array.from({ length: count }, (_, index) => ({
        id: `toolu_hist_${index + 1}`,
        type: "tool_use",
        name: "Task",
        input: { description: `Historical task ${index + 1}` },
      })),
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: Array.from({ length: count }, (_, index) => ({
        type: "tool_result",
        tool_use_id: `toolu_hist_${index + 1}`,
        content: `Result ${index + 1}`,
      })),
    },
  },
];

const snapshot = (overrides: Partial<StreamProgressSnapshot>): StreamProgressSnapshot => ({
  thinking: "",
  content: "",
  commandGroups: [],
  ...overrides,
});

const hostMeta = () => ({
  hostRunStatus: "completed",
  runtime: "claude-code",
  runtimeAlias: null as string | null,
  runtimeConfigurationId: null as string | null,
  model: "claude-opus-4-8",
  reasoning: "medium",
  fastMode: false,
  runCreatedAt: "2026-07-01T10:00:00.000Z",
  runUpdatedAt: "2026-07-01T10:05:00.000Z",
});

const setupWithLog = async (events: unknown[]) => {
  const db = await createTestDb();
  databases.push(db);
  const ctx = createCommandContext(db);
  const sessionId = `isess_${crypto.randomUUID()}`;
  const runId = `crun_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const logDir = join(tmpdir(), `aop-bg-backfill-${crypto.randomUUID()}`);
  await mkdir(logDir, { recursive: true });
  const logFilePath = join(logDir, "host.jsonl");
  await writeFile(logFilePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

  await ctx.chatSessionRepository.create({
    id: sessionId,
    repo_id: null,
    title: "Old session",
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
  await db
    .insertInto("chat_messages")
    .values({
      id: `${runId}_user`,
      session_id: sessionId,
      role: "user",
      content: "old work",
      action: null,
      turn_index: 1,
      disposition: "immediate",
      created_at: now,
    })
    .execute();
  await db
    .insertInto("chat_runs")
    .values({
      id: runId,
      session_id: sessionId,
      user_message_id: `${runId}_user`,
      assistant_message_id: `${runId}_assistant`,
      runtime: "claude-code",
      log_file_path: logFilePath,
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
      delegation_runs: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return { ctx, sessionId, runId, logFilePath };
};

const delegationRunsOf = async (ctx: LocalServerContext, runId: string) => {
  const row = await ctx.db
    .selectFrom("chat_runs")
    .select("delegation_runs")
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
  return parseChatDelegationRuns(row.delegation_runs);
};
