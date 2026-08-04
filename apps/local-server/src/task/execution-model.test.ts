import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { resolveTaskExecutionContext } from "./execution-model.ts";

describe("task/execution-model", () => {
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

  test("defaults to the task repository when no explicit execution model exists", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

    const repo = await ctx.repoRepository.getById("repo-1");
    if (!repo) {
      throw new Error("repo should exist");
    }

    const task = await ctx.taskRepository.get("task-1");
    if (!task) {
      throw new Error("task should exist");
    }

    const execution = await resolveTaskExecutionContext(task, repo.path, ctx.repoRepository);

    expect(execution.model).toBeNull();
    expect(execution.primaryRepository.repoId).toBe("repo-1");
    expect(execution.repositories).toEqual([
      {
        repoId: "repo-1",
        repoPath: repo.path,
        assignment: "primary",
        writable: true,
      },
    ]);
  });

  test("resolves supporting repositories from task execution metadata", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestRepo(db, "shared-ui", "/test/shared-ui");
    await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

    const repo = await ctx.repoRepository.getById("repo-1");
    const supportingRepo = await ctx.repoRepository.getById("shared-ui");
    if (!repo || !supportingRepo) {
      throw new Error("repositories should exist");
    }

    await Bun.write(
      join(repo.path, "docs/tasks/feat/task.md"),
      [
        "---",
        "id: task-1",
        "title: feat",
        "status: DRAFT",
        "changePath: changes/feat",
        "execution:",
        "  version: 1",
        "  coordinationMode: multi-repository",
        "  coordinationPhase: developers-implementing",
        "  architect:",
        "    agentId: architect-1",
        "    role: architect",
        "    repositories:",
        "      - repoId: repo-1",
        "        assignment: control-plane",
        "  developers:",
        "    - agentId: developer-1",
        "      role: developer",
        "      sliceId: slice-runtime",
        "      lifecycle: implementing",
        "      repositories:",
        "        - repoId: repo-1",
        "          assignment: primary",
        "        - repoId: shared-ui",
        "          assignment: supporting",
        "  guardrails:",
        "    maxTotalAgents: 6",
        "    maxDeveloperAgents: 5",
        "    maxDeveloperAssignmentsPerTask: 1",
        "    requireSinglePrimaryRepository: true",
        "    allowSupportingRepositories: true",
        "    architectRunsInControlPlane: true",
        "---",
        "",
        "## Description",
        "Execution aware task",
        "",
        "## Requirements",
        "- Use supporting repos",
        "",
        "## Acceptance Criteria",
        "- [ ] Supporting repos resolve",
        "",
      ].join("\n"),
    );

    const task = await ctx.taskRepository.get("task-1");
    if (!task) {
      throw new Error("task should exist");
    }

    const execution = await resolveTaskExecutionContext(task, repo.path, ctx.repoRepository);

    expect(execution.model?.coordinationMode).toBe("multi-repository");
    expect(execution.primaryRepository).toEqual({
      repoId: "repo-1",
      repoPath: repo.path,
      assignment: "primary",
      writable: true,
    });
    expect(execution.repositories).toEqual([
      {
        repoId: "repo-1",
        repoPath: repo.path,
        assignment: "primary",
        writable: true,
      },
      {
        repoId: "shared-ui",
        repoPath: supportingRepo.path,
        assignment: "supporting",
        writable: false,
      },
    ]);
  });
});
