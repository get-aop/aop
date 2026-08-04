import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createRuntimeEventRoutes } from "./routes.ts";

describe("runtime-events/routes", () => {
  let cleanupAopHome: () => void;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api", createRuntimeEventRoutes(ctx));
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("returns canonical runtime events for an execution", async () => {
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
    await ctx.executionRepository.saveStepLogs([
      {
        step_execution_id: "step-1",
        content: JSON.stringify({
          provider: "pi",
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Visible event" }],
          },
        }),
        created_at: "2026-01-01T00:00:01.000Z",
      },
    ]);

    const response = await app.request("/api/executions/exec-1/runtime-events");
    const body: AnyJson = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        executionId: "exec-1",
        kind: "assistant_text",
        message: "Visible event",
      }),
    ]);
  });

  test("returns 404 when the execution does not exist", async () => {
    const response = await app.request("/api/executions/missing/runtime-events");
    const body: AnyJson = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Execution not found");
  });
});
