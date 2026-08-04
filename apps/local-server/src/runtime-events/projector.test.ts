import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { projectRuntimeEventsForStep } from "./projector.ts";

describe("runtime event projector", () => {
  let cleanupAopHome: () => void;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: "running",
      started_at: "2026-01-01T00:00:00.000Z",
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: "running",
      started_at: "2026-01-01T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("projects canonical Pi runtime events from step logs", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "session_started",
          session_id: "pi-session-1",
        }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "I am checking the task." }],
          },
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "tool_execution_start",
          toolName: "read",
          args: { path: "README.md" },
        }),
        created_at: "2026-01-01T00:00:03.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "tool_execution_end",
          toolName: "read",
          result: "ok",
        }),
        created_at: "2026-01-01T00:00:04.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "agent_end",
          session_id: "pi-session-1",
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "Done" }],
            },
          ],
        }),
        created_at: "2026-01-01T00:00:05.000Z",
      },
    ]);

    await projectRuntimeEventsForStep(ctx, "step-1");

    const events = await ctx.runtimeEventRepository.listByExecutionId("exec-1");
    expect(events.map((event) => event.kind)).toEqual([
      "session_started",
      "assistant_text",
      "tool_started",
      "tool_completed",
      "session_completed",
    ]);
    expect(events[0]?.sessionId).toBe("pi-session-1");
    expect(events[1]?.message).toBe("I am checking the task.");
    expect(events[2]?.toolName).toBe("Read");
    expect(events[3]?.status).toBe("success");

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.session_id).toBe("pi-session-1");
  });

  test("projects Pi runtime events with Pi provider metadata", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "session_started",
          id: "pi-session-1",
          session_id: "pi-session-1",
        }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "assistant",
          message: { content: [{ type: "text", text: "Pi is checking the task." }] },
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "agent_end",
          session_id: "pi-session-1",
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "Pi completed the task." }],
            },
          ],
        }),
        created_at: "2026-01-01T00:00:03.000Z",
      },
    ]);

    await projectRuntimeEventsForStep(ctx, "step-1");

    const events = await ctx.runtimeEventRepository.listByExecutionId("exec-1");
    expect(events.map((event) => event.title)).toEqual([
      "Pi session started",
      "Pi session completed",
    ]);
    expect(events[0]?.metadata?.provider).toBe("pi");
    expect(events[1]?.metadata?.provider).toBe("pi");
  });

  test("projects Codex CLI runtime events with Codex provider metadata", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          type: "thread.started",
          thread_id: "codex-session-1",
        }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          type: "turn.completed",
          "last-assistant-message": "Codex completed the task.",
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      },
    ]);

    await projectRuntimeEventsForStep(ctx, "step-1");

    const events = await ctx.runtimeEventRepository.listByExecutionId("exec-1");
    expect(events.map((event) => event.title)).toEqual([
      "Codex CLI session started",
      "Assistant update",
      "Codex CLI session completed",
    ]);
    expect(events[0]?.metadata?.provider).toBe("codex-cli");
    expect(events[2]?.metadata?.provider).toBe("codex-cli");
  });

  test("dedupes when the same step logs are projected twice", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "Only once" }] },
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      },
    ]);

    await projectRuntimeEventsForStep(ctx, "step-1");
    await projectRuntimeEventsForStep(ctx, "step-1");

    const events = await ctx.runtimeEventRepository.listByExecutionId("exec-1");
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toBe("Only once");
  });

  test("projects large log batches without overflowing SQLite parameters", async () => {
    await ctx.executionRepository.saveStepLogs(
      Array.from({ length: 20_000 }, (_, index) => ({
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `line ${index + 1}` }],
          },
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      })),
    );

    await projectRuntimeEventsForStep(ctx, "step-1");

    const events = await ctx.runtimeEventRepository.listByExecutionId("exec-1");
    expect(events).toHaveLength(20_000);
  });

  test("marks Pi agent_end events as completed sessions", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({ type: "session", id: "pi-session-1" }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          type: "agent_end",
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "SIGNAL: READY_FOR_REVIEW" }],
            },
          ],
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      },
    ]);

    await projectRuntimeEventsForStep(ctx, "step-1");

    const summary = await ctx.runtimeEventRepository.getActivitySummary("task-1");
    const events = await ctx.runtimeEventRepository.listByExecutionId("exec-1");

    expect(events.map((event) => event.kind)).toEqual(["session_started", "session_completed"]);
    expect(summary?.sessionState).toBe("completed");
    expect(summary?.latestMessage).toBe("SIGNAL: READY_FOR_REVIEW");
  });

  test("keeps large completed session output out of compact activity summaries", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({ provider: "pi", type: "session_started", id: "pi-session-1" }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "agent_end",
          session_id: "pi-session-1",
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "log chunk ".repeat(1_000) }],
            },
          ],
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      },
    ]);

    await projectRuntimeEventsForStep(ctx, "step-1");

    const summary = await ctx.runtimeEventRepository.getActivitySummary("task-1");

    expect(summary?.sessionState).toBe("completed");
    expect(summary?.latestMessage).toBe("Pi session completed");
  });

  test("activity summary exposes durable runtime state without raw provider payloads", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          type: "requires_input",
          question: "Approve the plan?",
          raw_secret: "do-not-expose",
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      },
    ]);

    await projectRuntimeEventsForStep(ctx, "step-1");

    const summary = await ctx.runtimeEventRepository.getActivitySummary("task-1");
    const events = await ctx.runtimeEventRepository.listByExecutionId("exec-1");

    expect(summary?.needsAttention).toBe(true);
    expect(summary?.latestMessage).toBe("Approve the plan?");
    expect(JSON.stringify(events)).not.toContain("do-not-expose");
  });

  test("activity summary treats new activity after a failed session event as running", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "opencode",
          type: "session_started",
          session_id: "session-1",
        }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "opencode",
          type: "error",
          error: "Read failed",
        }),
        created_at: "2026-01-01T00:00:02.000Z",
      },
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "opencode",
          type: "tool_execution_start",
          toolName: "Read",
          args: { path: "apps/local-server/src/task/routes.ts" },
        }),
        created_at: "2026-01-01T00:00:03.000Z",
      },
    ]);

    await projectRuntimeEventsForStep(ctx, "step-1");

    const summary = await ctx.runtimeEventRepository.getActivitySummary("task-1");

    expect(summary?.latestEventKind).toBe("tool_started");
    expect(summary?.sessionState).toBe("running");
  });

  test("synthesizes session_completed when a finished step's logs lack a terminal record", async () => {
    // opencode streams end with plain text parts — no result/terminal record.
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "opencode",
          type: "text",
          sessionID: "ses-opencode-1",
          part: { type: "text", sessionID: "ses-opencode-1", text: "Implemented the fix." },
        }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
    ]);
    await ctx.executionRepository.updateStepExecution("step-1", {
      status: "success",
      ended_at: "2026-01-01T00:10:00.000Z",
    });

    await projectRuntimeEventsForStep(ctx, "step-1");
    // Re-projection (read path) must not duplicate the synthetic event.
    await projectRuntimeEventsForStep(ctx, "step-1");

    const events = await ctx.runtimeEventRepository.listByExecutionId("exec-1");
    const terminalEvents = events.filter((event) => event.kind === "session_completed");
    expect(terminalEvents).toHaveLength(1);

    const summary = await ctx.runtimeEventRepository.getActivitySummary("task-1");
    expect(summary?.sessionState).toBe("completed");
  });

  test("does not synthesize a terminal event while the step is still running", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "opencode",
          type: "text",
          part: { type: "text", text: "Still working on it." },
        }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
    ]);

    await projectRuntimeEventsForStep(ctx, "step-1");

    const summary = await ctx.runtimeEventRepository.getActivitySummary("task-1");
    expect(summary?.sessionState).toBe("running");
  });

  test("does not duplicate a terminal event the logs already provide", async () => {
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "agent_end",
          session_id: "pi-session-9",
          messages: [{ role: "assistant", content: [{ type: "text", text: "Done" }] }],
        }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
    ]);
    await ctx.executionRepository.updateStepExecution("step-1", {
      status: "success",
      ended_at: "2026-01-01T00:10:00.000Z",
    });

    await projectRuntimeEventsForStep(ctx, "step-1");

    const events = await ctx.runtimeEventRepository.listByExecutionId("exec-1");
    expect(events.filter((event) => event.kind === "session_completed")).toHaveLength(1);
  });

  test("synthesizes session_failed for failed steps even without any logs", async () => {
    await ctx.executionRepository.updateStepExecution("step-1", {
      status: "failure",
      error: "agent exited with code 1",
      ended_at: "2026-01-01T00:10:00.000Z",
    });

    await projectRuntimeEventsForStep(ctx, "step-1");

    const summary = await ctx.runtimeEventRepository.getActivitySummary("task-1");
    expect(summary?.sessionState).toBe("failed");
    expect(summary?.latestMessage).toBe("agent exited with code 1");
  });
});
