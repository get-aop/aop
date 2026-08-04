import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { getCanonicalTaskDir } from "../task-docs/paths.ts";
import { createTaskPackage } from "./creation.ts";

describe("createTaskPackage", () => {
  test("createTaskPackage writes task.md and plan.md", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-task-create-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_task_create", repoPath);

    const task = await createTaskPackage(ctx, {
      repoId: "repo_task_create",
      title: "Add health endpoint",
      description: "Expose /health for uptime checks",
      planMarkdown:
        "## Plan\n1. Add route\n\n## Acceptance Criteria\n- [ ] GET /health returns 200",
    });

    expect(task.status).toBe("DRAFT");
    expect(await ctx.taskAssignmentRepository.getCurrentByTaskId(task.id)).toBeNull();

    const taskDir = getCanonicalTaskDir(task.repo_id, task.change_path);
    const taskMarkdown = await Bun.file(join(taskDir, "task.md")).text();
    expect(taskMarkdown).toContain("title: Add health endpoint");
    expect(taskMarkdown).toContain("Expose /health for uptime checks");
    expect(await Bun.file(join(taskDir, "plan.md")).text()).toContain("## Plan");
    expect(await Bun.file(join(taskDir, "task.md")).text()).toContain("Follow `plan.md`.");
    expect(await Bun.file(join(taskDir, "prd.md")).exists()).toBe(false);
    expect(await Bun.file(join(taskDir, "issues.md")).exists()).toBe(false);

    await db.destroy();
  });

  test("rejects incomplete generated artifacts", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo_task_invalid", tmpdir());

    await expect(
      createTaskPackage(ctx, {
        repoId: "repo_task_invalid",
        title: "Incomplete task",
        description: "Missing plan",
        planMarkdown: "",
      }),
    ).rejects.toThrow("plan.md is required");

    await db.destroy();
  });

  test("persists an explicitly selected workflow on the task", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo_task_workflow", tmpdir());

    const task = await createTaskPackage(ctx, {
      repoId: "repo_task_workflow",
      title: "Workflow-bound task",
      description: "Use the selected chat workflow.",
      planMarkdown: "## Plan\n1. Run the selected workflow.",
      preferredWorkflow: "review-pipeline",
    });

    expect(task.preferred_workflow).toBe("review-pipeline");
    await db.destroy();
  });
});
