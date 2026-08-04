import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createRepoRoutes } from "../repo/routes.ts";

describe("task/change-files", () => {
  let cleanupAopHome: (() => void) | undefined;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let app: Hono;
  const repoId = "repo-cf";

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, repoId, aopPaths.repoDir(repoId));
    await ctx.taskRepository.createIdempotent({
      id: "task-change-files",
      repo_id: repoId,
      change_path: "docs/tasks/test-change",
      status: "DRAFT",
    });
    app = new Hono();
    app.route("/api/repos", createRepoRoutes(ctx));
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome?.();
    rmSync(aopPaths.repoDir(repoId), { recursive: true, force: true });
  });

  test("lists canonical task artifacts", async () => {
    await Bun.write(join(aopPaths.repoTask(repoId, "test-change"), "prd.md"), "# PRD");

    const response = await app.request(
      "http://localhost/api/repos/repo-cf/tasks/task-change-files/files",
    );
    const body = (await response.json()) as { files: string[] };

    expect(response.status).toBe(200);
    expect(body.files).toContain("task.md");
    expect(body.files).toContain("prd.md");
  });

  test("submits review notes without launching a worker", async () => {
    const taskPath = aopPaths.repoTask(repoId, "test-change");
    await Bun.write(join(taskPath, "issues.md"), "# Issues\n\nImplementation steps");
    const create = await app.request(
      "http://localhost/api/repos/repo-cf/tasks/task-change-files/review-notes",
      {
        method: "POST",
        body: JSON.stringify({
          filePath: "issues.md",
          selectedText: "Implementation steps",
          note: "Split this into backend and frontend slices.",
        }),
      },
    );
    expect(create.status).toBe(200);

    const submit = await app.request(
      "http://localhost/api/repos/repo-cf/tasks/task-change-files/review-notes/submit",
      { method: "POST" },
    );
    const body = (await submit.json()) as { regenerating: boolean; submittedCount: number };

    expect(submit.status).toBe(200);
    expect(body).toMatchObject({ regenerating: false, submittedCount: 1 });
    expect(await Bun.file(join(taskPath, "plan-review.md")).text()).toContain(
      "Split this into backend and frontend slices.",
    );
  });
});
