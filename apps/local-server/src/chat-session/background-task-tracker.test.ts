import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { ChatDelegationRun } from "@aop/common";
import { parseChatDelegationRuns } from "@aop/common";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { ChatRun, ChatSession } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import {
  buildBackgroundTaskContent,
  createBackgroundTaskTracker,
  extractBackgroundTaskRows,
  isBackgroundTaskToolName,
} from "./background-task-tracker.ts";
import { readDelegationOutput } from "./delegation-runs.ts";
import { type ChatSessionEvent, subscribeChatSession } from "./session-events.ts";
import type { StreamProgressSnapshot } from "./stream-progress.ts";

const databases: Array<Awaited<ReturnType<typeof createTestDb>>> = [];
const listeners: Array<() => void> = [];

beforeEach(() => {
  for (const unsubscribe of listeners.splice(0)) unsubscribe();
});

afterEach(async () => {
  for (const unsubscribe of listeners.splice(0)) unsubscribe();
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

describe("isBackgroundTaskToolName", () => {
  test("matches Task and Agent variants and provider labels", () => {
    expect(isBackgroundTaskToolName("Task")).toBe(true);
    expect(isBackgroundTaskToolName("Agent")).toBe(true);
    expect(isBackgroundTaskToolName("task")).toBe(true);
    expect(isBackgroundTaskToolName("agent")).toBe(true);
    expect(isBackgroundTaskToolName("Task tool")).toBe(true);
    expect(isBackgroundTaskToolName("Collab agent tool call")).toBe(true);
    expect(isBackgroundTaskToolName("spawn_subagent")).toBe(true);
    expect(isBackgroundTaskToolName("Background Task")).toBe(true);
  });

  test("rejects ordinary tools", () => {
    expect(isBackgroundTaskToolName("Bash")).toBe(false);
    expect(isBackgroundTaskToolName("Read")).toBe(false);
    expect(isBackgroundTaskToolName("Grep")).toBe(false);
    expect(isBackgroundTaskToolName("Write")).toBe(false);
    expect(isBackgroundTaskToolName("Tool")).toBe(false);
  });
});

describe("extractBackgroundTaskRows", () => {
  test("keeps only Task/Agent command rows", () => {
    const rows = extractBackgroundTaskRows({
      thinking: "",
      content: "",
      commandGroups: [
        {
          id: "cg_1",
          commands: [
            { id: "toolu_bash", command: "Bash", status: "done", exitCode: 0 },
            {
              id: "toolu_agent",
              command: "Agent",
              detail: "Inspect the renderer",
              status: "running",
            },
            {
              id: "toolu_collab",
              command: "Collab agent tool call",
              detail: "Codex collab",
              status: "running",
            },
            { id: "toolu_task", command: "Task", detail: "Run tests", status: "done", exitCode: 0 },
          ],
        },
      ],
    });
    expect(rows.map((row) => row.id)).toEqual(["toolu_agent", "toolu_collab", "toolu_task"]);
  });
});

describe("buildBackgroundTaskContent", () => {
  test("includes host activity while running and result when complete", () => {
    const running = buildBackgroundTaskContent(
      "Inspect cards",
      { id: "t1", command: "Task", detail: "Inspect cards", status: "running" },
      {
        thinking: "",
        content: "Still looking at the panel.",
        commandGroups: [],
      },
      "running",
    );
    expect(running).toContain("## Inspect cards");
    expect(running).toContain("Status: running");
    expect(running).toContain("Still looking at the panel.");

    const done = buildBackgroundTaskContent(
      "Inspect cards",
      {
        id: "t1",
        command: "Task",
        detail: "Inspect cards",
        result: "Three cards found.",
        status: "done",
      },
      { thinking: "", content: "", commandGroups: [] },
      "completed",
    );
    expect(done).toContain("Status: completed");
    expect(done).toContain("## Result");
    expect(done).toContain("Three cards found.");
  });
});

describe("createBackgroundTaskTracker", () => {
  test("starts a background-task card when Task starts and completes it on done", async () => {
    const { ctx, session, run, events } = await setup();
    const track = createBackgroundTaskTracker({ ctx, hostRun: run, session });

    track(
      snapshot({
        content: "Launching explorer",
        commandGroups: [
          {
            id: "cg_1",
            commands: [
              {
                id: "toolu_task_1",
                command: "Task",
                detail: "Explore delegation UI",
                status: "running",
              },
            ],
          },
        ],
      }),
    );
    await flushTracker();

    const started = await delegationRunsOf(ctx, run.id);
    expect(started).toHaveLength(1);
    expect(started[0]?.kind).toBe("background-task");
    expect(started[0]?.label).toBe("Explore delegation UI");
    expect(started[0]?.toolUseId).toBe("toolu_task_1");
    expect(started[0]?.status).toBe("active");
    expect(started[0]?.logFilePath).toBeTruthy();
    expect(events.some((event) => event.type === "delegation-updated")).toBe(true);
    expect(events.some((event) => event.type === "delegation-progress")).toBe(true);

    const startedPath = started[0]?.logFilePath ?? "";
    expect(startedPath).toBeTruthy();
    const liveLog = await readFile(startedPath, "utf8");
    expect(liveLog).toContain("Explore delegation UI");
    expect(liveLog).toContain("Launching explorer");

    track(
      snapshot({
        content: "Still working on explore",
        commandGroups: [
          {
            id: "cg_1",
            commands: [
              {
                id: "toolu_task_1",
                command: "Task",
                detail: "Explore delegation UI",
                status: "running",
              },
            ],
          },
        ],
      }),
    );
    await flushTracker();

    const progressEvents = events.filter((event) => event.type === "delegation-progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    const latestProgress = progressEvents.at(-1);
    expect(latestProgress && "content" in latestProgress ? latestProgress.content : "").toContain(
      "Still working on explore",
    );

    track(
      snapshot({
        commandGroups: [
          {
            id: "cg_1",
            commands: [
              {
                id: "toolu_task_1",
                command: "Task",
                detail: "Explore delegation UI",
                result: "UI reuses the card stack.",
                status: "done",
                exitCode: 0,
              },
            ],
          },
        ],
      }),
    );
    await flushTracker();

    const finished = await delegationRunsOf(ctx, run.id);
    expect(finished).toHaveLength(1);
    expect(finished[0]?.status).toBe("completed");
    expect(finished[0]?.activity).toBe("Completed");

    const finishedPath = finished[0]?.logFilePath ?? "";
    expect(finishedPath).toBeTruthy();
    const output = await readDelegationOutput(finishedPath);
    expect(output.content).toContain("Explore delegation UI");
    expect(output.content).toContain("Status: completed");
    expect(output.content).toContain("UI reuses the card stack.");
  });

  test("flush waits for queued progress before host finalization", async () => {
    const { ctx, session, run } = await setup();
    const track = createBackgroundTaskTracker({ ctx, hostRun: run, session });

    track(
      snapshot({
        commandGroups: [
          {
            id: "cg_1",
            commands: [
              {
                id: "toolu_agent_flush",
                command: "Agent",
                detail: "Check dropdown files",
                status: "running",
              },
            ],
          },
        ],
      }),
    );
    await track.flush();

    const entries = await delegationRunsOf(ctx, run.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.toolUseId).toBe("toolu_agent_flush");
    expect(entries[0]?.status).toBe("active");
  });

  test("does not double-start the same tool_use id", async () => {
    const { ctx, session, run } = await setup();
    const track = createBackgroundTaskTracker({ ctx, hostRun: run, session });
    const running = snapshot({
      commandGroups: [
        {
          id: "cg_1",
          commands: [
            { id: "toolu_agent_1", command: "Agent", detail: "Search code", status: "running" },
          ],
        },
      ],
    });
    track(running);
    track(running);
    await flushTracker();

    expect(await delegationRunsOf(ctx, run.id)).toHaveLength(1);
  });

  test("marks failed tool results as failed cards", async () => {
    const { ctx, session, run } = await setup();
    const track = createBackgroundTaskTracker({ ctx, hostRun: run, session });
    track(
      snapshot({
        commandGroups: [
          {
            id: "cg_1",
            commands: [{ id: "toolu_1", command: "Agent", detail: "Broken", status: "running" }],
          },
        ],
      }),
    );
    await flushTracker();
    track(
      snapshot({
        commandGroups: [
          {
            id: "cg_1",
            commands: [
              {
                id: "toolu_1",
                command: "Agent",
                detail: "Broken",
                result: "tool exploded",
                status: "failed",
                exitCode: 1,
              },
            ],
          },
        ],
      }),
    );
    await flushTracker();

    const finished = await delegationRunsOf(ctx, run.id);
    expect(finished[0]?.status).toBe("failed");
    expect(finished[0]?.error).toBe("Background task failed.");
    expect(finished[0]?.activity).toBe("Failed");
    const failedPath = finished[0]?.logFilePath ?? "";
    expect(failedPath).toBeTruthy();
    const output = await readDelegationOutput(failedPath);
    expect(output.content).toContain("tool exploded");
  });

  test("tracks Codex-style collab agent tool labels", async () => {
    const { ctx, session, run } = await setup();
    const track = createBackgroundTaskTracker({ ctx, hostRun: run, session });
    track(
      snapshot({
        commandGroups: [
          {
            id: "cg_1",
            commands: [
              {
                id: "item_9",
                command: "Collab agent tool call",
                detail: "Review the patch",
                status: "running",
              },
            ],
          },
        ],
      }),
    );
    await flushTracker();
    const started = await delegationRunsOf(ctx, run.id);
    expect(started).toHaveLength(1);
    expect(started[0]?.label).toBe("Review the patch");
  });

  test("ignores ordinary tool rows", async () => {
    const { ctx, session, run } = await setup();
    const track = createBackgroundTaskTracker({ ctx, hostRun: run, session });
    track(
      snapshot({
        commandGroups: [
          {
            id: "cg_1",
            commands: [
              { id: "toolu_bash", command: "Bash", status: "running" },
              { id: "toolu_read", command: "Read", detail: "/tmp/a.ts", status: "running" },
            ],
          },
        ],
      }),
    );
    await flushTracker();
    expect(await delegationRunsOf(ctx, run.id)).toEqual([]);
  });
});

const flushTracker = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const snapshot = (overrides: Partial<StreamProgressSnapshot>): StreamProgressSnapshot => ({
  thinking: "",
  content: "",
  commandGroups: [],
  ...overrides,
});

const setup = async () => {
  const db = await createTestDb();
  databases.push(db);
  const ctx = createCommandContext(db);
  const sessionId = `isess_${crypto.randomUUID()}`;
  const runId = `crun_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await ctx.chatSessionRepository.create({
    id: sessionId,
    repo_id: null,
    title: "Background task host",
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
      content: "spawn agents",
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
      log_file_path: "/tmp/host.jsonl",
      status: "running",
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
      created_at: now,
      updated_at: now,
    })
    .execute();

  const session = (await db
    .selectFrom("chat_sessions")
    .selectAll()
    .where("id", "=", sessionId)
    .executeTakeFirstOrThrow()) as ChatSession;
  const run = (await db
    .selectFrom("chat_runs")
    .selectAll()
    .where("id", "=", runId)
    .executeTakeFirstOrThrow()) as ChatRun;
  const events: ChatSessionEvent[] = [];
  listeners.push(subscribeChatSession(sessionId, (event) => events.push(event)));
  return { ctx, session, run, events };
};

const delegationRunsOf = async (
  ctx: LocalServerContext,
  runId: string,
): Promise<ChatDelegationRun[]> => {
  const row = await ctx.db
    .selectFrom("chat_runs")
    .select("delegation_runs")
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
  return parseChatDelegationRuns(row.delegation_runs);
};
