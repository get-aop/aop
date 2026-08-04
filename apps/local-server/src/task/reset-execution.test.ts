import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { resetTaskExecution } from "./reset-execution.ts";

describe("resetTaskExecution", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("returns task to DRAFT and clears execution history", async () => {
    await createTestRepo(db, "repo-reset", "repo-reset");
    await createTestTask(db, "task-reset", "repo-reset", "docs/tasks/demo-reset", "BLOCKED");

    const taskDir = join(aopPaths.repoDir("repo-reset"), "docs/tasks/demo-reset");
    writeFileSync(
      join(taskDir, "001-demo-reset.md"),
      `---
title: Demo reset
status: DONE
---

### Description
Demo subtask

### Context

### Result

### Review

### Blockers

`,
    );
    await ctx.taskRepository.refresh();
    const task = await ctx.taskRepository.getByChangePath("repo-reset", "docs/tasks/demo-reset");
    if (!task) throw new Error("expected task on disk");

    await ctx.executionRepository.createExecution({
      id: "exec-reset-1",
      task_id: "task-reset",
      workflow_id: "aop-default-gpt",
      status: "failed",
      visited_steps: "[]",
      iteration: 0,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    const result = await resetTaskExecution(ctx, task.id);

    expect(result).toEqual({ success: true, taskId: task.id, aborted: false });
    expect((await ctx.taskRepository.get(task.id))?.status).toBe("DRAFT");
    expect(await ctx.executionRepository.getExecutionsByTaskId(task.id)).toHaveLength(0);
  });
});
