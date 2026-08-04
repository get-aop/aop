import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { serializeFrontmatter } from "../task-docs/frontmatter.ts";
import { createTaskEventEmitter, type TaskEventEmitter } from "./task-events.ts";

interface SSEParsedEvent {
  event: string;
  data: string;
}

const parseSSEEvents = (text: string): SSEParsedEvent[] => {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const parsed: SSEParsedEvent = { event: "", data: "" };
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) parsed.event = line.slice(6).trim();
        if (line.startsWith("data:")) parsed.data = line.slice(5).trim();
      }
      return parsed;
    })
    .filter((event) => event.event.length > 0);
};

const collectChunks = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxReads: number,
  timeoutMs = 500,
): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";

  for (let index = 0; index < maxReads; index++) {
    const timeout = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), timeoutMs),
    );
    const result = await Promise.race([reader.read(), timeout]);
    if (result.value) {
      text += decoder.decode(result.value);
    }
    if (result.done) {
      break;
    }
  }

  return text;
};

describe("events/routes swimlane metadata", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let emitter: TaskEventEmitter;
  let app: ReturnType<typeof createApp>;
  let repoPath: string;

  beforeEach(async () => {
    db = await createTestDb();
    emitter = createTaskEventEmitter();
    ctx = createCommandContext(db, { taskEventEmitter: emitter });
    app = createApp({
      ctx,
      startTimeMs: Date.now(),
      isReady: () => true,
    });
    repoPath = await mkdtemp(join(tmpdir(), "aop-events-swimlane-"));
    await createTestRepo(db, "repo-1", repoPath);
  });

  afterEach(async () => {
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("includes swimlane metadata in init and status change events", async () => {
    const changePath = "docs/tasks/get-57-sse";
    await createTestTask(db, "task-1", "repo-1", changePath, "WORKING");
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      workflow_id: "aop-default-gpt",
      status: "running",
      started_at: "2026-03-31T00:05:00.000Z",
    });

    await Bun.write(
      join(repoPath, changePath, "task.md"),
      serializeFrontmatter({
        frontmatter: {
          id: "task-1",
          title: "GET-57 SSE swimlane",
          status: "WORKING",
          created: "2026-03-31T00:00:00.000Z",
          changePath,
          execution: {
            version: 1,
            coordinationMode: "single-repository",
            coordinationPhase: "developers-verifying",
            architect: {
              agentId: "architect-1",
              role: "architect",
              repositories: [{ repoId: "repo-1", assignment: "control-plane" }],
            },
            developers: [
              {
                agentId: "developer-2",
                role: "developer",
                sliceId: "slice-ui",
                lifecycle: "verifying",
                repositories: [{ repoId: "repo-1", assignment: "primary" }],
              },
            ],
          },
        },
        content: [
          "",
          "## Description",
          "SSE enrichment test.",
          "",
          "## Requirements",
          "",
          "## Acceptance Criteria",
          "- [ ] Emit swimlane metadata.",
          "",
        ].join("\n"),
      }),
    );

    const controller = new AbortController();
    const response = await app.request("/api/events", {
      signal: controller.signal,
    });

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const textBeforeUpdate = await collectChunks(
      reader as ReadableStreamDefaultReader<Uint8Array>,
      2,
    );
    await ctx.taskRepository.update("task-1", { status: "DONE" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const textAfterUpdate = await collectChunks(
      reader as ReadableStreamDefaultReader<Uint8Array>,
      4,
    );
    controller.abort();

    const events = parseSSEEvents(textBeforeUpdate + textAfterUpdate);
    const initEvent = events.find((event) => event.event === "init");
    const statusEvent = events.find((event) => event.event === "task-status-changed");

    expect(initEvent).toBeDefined();
    expect(statusEvent).toBeDefined();

    const initData = JSON.parse(initEvent?.data ?? "{}");
    const changedData = JSON.parse(statusEvent?.data ?? "{}");

    expect(initData.status.repos[0].tasks[0].swimlane).toEqual({
      laneId: "developer-execution",
      phaseLabel: "Verifying",
      ownerLabel: "developer-2",
      ownerRole: "developer",
    });
    expect(initData.status.repos[0].tasks[0].currentExecutionId).toBe("exec-1");
    expect(initData.status.repos[0].tasks[0].executionStartedAt).toBe("2026-03-31T00:05:00.000Z");
    expect(changedData.task.swimlane).toEqual({
      laneId: "completed",
      phaseLabel: "Completed",
      ownerLabel: "architect-1",
      ownerRole: "architect",
    });
    expect(changedData.task.currentExecutionId).toBe("exec-1");
    expect(changedData.task.executionStartedAt).toBe("2026-03-31T00:05:00.000Z");
  });
});
