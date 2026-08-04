import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database, Repo } from "../../db/schema.ts";
import { createTestDb, createTestRepo } from "../../db/test-utils.ts";
import { writeTaskDoc } from "../../task-docs/task.ts";
import { reconcileRepo } from "./reconcile.ts";

describe("orchestrator/watcher/reconcile", () => {
  let cleanupAopHome: (() => void) | undefined;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;
  let repo: Repo;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = join(tmpdir(), `aop-reconcile-${Date.now()}`);
    await createTestRepo(db, "repo-1", repoPath);
    const createdRepo = await ctx.repoRepository.getById("repo-1");
    if (!createdRepo) {
      throw new Error("Missing test repo");
    }
    repo = createdRepo;
  });

  afterEach(async () => {
    cleanupAopHome?.();
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("rebuilds Linear source and dependency rows from canonical .aop task docs", async () => {
    const rootDir = aopPaths.repoTask(repo.id, "abc-123-auth-flow");
    const blockerDir = aopPaths.repoTask(repo.id, "abc-120-provision-database");
    await mkdir(rootDir, { recursive: true });
    await mkdir(blockerDir, { recursive: true });

    await writeTaskDoc(
      join(rootDir, "task.md"),
      {
        id: "task-root",
        title: "Auth Flow",
        status: "DRAFT",
        created: "2026-03-12T12:00:00.000Z",
        changePath: "docs/tasks/abc-123-auth-flow",
        source: {
          provider: "linear",
          id: "lin_abc_123",
          ref: "ABC-123",
          url: "https://linear.app/acme/issue/ABC-123/auth-flow",
        },
        dependencySources: [
          {
            provider: "linear",
            id: "lin_abc_120",
            ref: "ABC-120",
          },
        ],
      },
      [
        "",
        "## Description",
        "Imported from Linear",
        "",
        "## Requirements",
        "- Review the ticket",
        "",
        "## Acceptance Criteria",
        "- [ ] Match the Linear intent",
        "",
      ].join("\n"),
    );
    await writeTaskDoc(
      join(blockerDir, "task.md"),
      {
        id: "task-blocker",
        title: "Provision Database",
        status: "DRAFT",
        created: "2026-03-12T12:00:00.000Z",
        changePath: "docs/tasks/abc-120-provision-database",
        source: {
          provider: "linear",
          id: "lin_abc_120",
          ref: "ABC-120",
          url: "https://linear.app/acme/issue/ABC-120/provision-database",
        },
        dependencyImported: true,
      },
      [
        "",
        "## Description",
        "Imported from Linear",
        "",
        "## Requirements",
        "- Review the ticket",
        "",
        "## Acceptance Criteria",
        "- [ ] Match the Linear intent",
        "",
      ].join("\n"),
    );

    await reconcileRepo(repo, {
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
    });

    expect(await ctx.linearStore.getTaskSourceByExternalId("repo-1", "lin_abc_123")).toMatchObject({
      task_id: "task-root",
      external_ref: "ABC-123",
    });
    expect(await ctx.linearStore.getTaskSourceByExternalId("repo-1", "lin_abc_120")).toMatchObject({
      task_id: "task-blocker",
      external_ref: "ABC-120",
    });
    expect(await ctx.linearStore.listTaskDependencies("task-root")).toMatchObject([
      {
        task_id: "task-root",
        depends_on_task_id: "task-blocker",
        source: "linear_blocks",
      },
    ]);
  });

  test("rebuilds non-Linear source and dependency rows from canonical .aop task docs", async () => {
    const rootDir = aopPaths.repoTask(repo.id, "get-50-jira-parity");
    const blockerDir = aopPaths.repoTask(repo.id, "get-49-linear-parity");
    await mkdir(rootDir, { recursive: true });
    await mkdir(blockerDir, { recursive: true });

    await writeTaskDoc(
      join(rootDir, "task.md"),
      {
        id: "task-root",
        title: "Jira Parity",
        status: "DRAFT",
        created: "2026-03-12T12:00:00.000Z",
        changePath: "docs/tasks/get-50-jira-parity",
        source: {
          provider: "jira",
          id: "jira-50",
          ref: "GET-50",
          url: "https://acme.atlassian.net/browse/GET-50",
        },
        dependencySources: [
          {
            provider: "jira",
            id: "jira-49",
            ref: "GET-49",
          },
        ],
      },
      [
        "",
        "## Description",
        "Imported from Jira",
        "",
        "## Requirements",
        "- Review the issue",
        "",
        "## Acceptance Criteria",
        "- [ ] Match the Jira intent",
        "",
      ].join("\n"),
    );
    await writeTaskDoc(
      join(blockerDir, "task.md"),
      {
        id: "task-blocker",
        title: "Linear Parity",
        status: "DRAFT",
        created: "2026-03-12T12:00:00.000Z",
        changePath: "docs/tasks/get-49-linear-parity",
        source: {
          provider: "jira",
          id: "jira-49",
          ref: "GET-49",
          url: "https://acme.atlassian.net/browse/GET-49",
        },
        dependencyImported: true,
      },
      [
        "",
        "## Description",
        "Imported from Jira",
        "",
        "## Requirements",
        "- Review the issue",
        "",
        "## Acceptance Criteria",
        "- [ ] Match the Jira intent",
        "",
      ].join("\n"),
    );

    await reconcileRepo(repo, {
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
    });

    expect(
      await ctx.externalIssueStore.getTaskSourceByExternalId("repo-1", "jira", "jira-50"),
    ).toMatchObject({
      task_id: "task-root",
      provider: "jira",
      external_ref: "GET-50",
    });
    expect(
      await ctx.externalIssueStore.getTaskSourceByExternalId("repo-1", "jira", "jira-49"),
    ).toMatchObject({
      task_id: "task-blocker",
      provider: "jira",
      external_ref: "GET-49",
    });
    expect(await ctx.externalIssueStore.listTaskDependencies("task-root")).toMatchObject([
      {
        task_id: "task-root",
        depends_on_task_id: "task-blocker",
        source: "jira_blocks",
      },
    ]);
  });

  test("does not discover legacy repo-local docs/tasks folders by default", async () => {
    const legacyDir = join(repoPath, "docs/tasks/legacy-auth-flow");
    await mkdir(legacyDir, { recursive: true });

    await writeTaskDoc(
      join(legacyDir, "task.md"),
      {
        id: "task-legacy",
        title: "Legacy Auth Flow",
        status: "DRAFT",
        created: "2026-03-12T12:00:00.000Z",
        changePath: "docs/tasks/legacy-auth-flow",
      },
      ["", "## Description", "Legacy doc", ""].join("\n"),
    );

    const result = await reconcileRepo(repo, {
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
      settingsRepository: ctx.settingsRepository,
    });

    expect(result.created).toBe(0);
    expect(result.removed).toBe(0);
    expect(
      await ctx.taskRepository.getByChangePath("repo-1", "docs/tasks/legacy-auth-flow"),
    ).toBeNull();
  });

  test("keeps persisted task when canonical docs contain only plan.md", async () => {
    const taskDir = aopPaths.repoTask(repo.id, "cli-plan-only-task");
    await mkdir(taskDir, { recursive: true });
    await Bun.write(join(taskDir, "plan.md"), "# CLI Plan\n\nShip it.");
    await ctx.taskRepository.createIdempotentRecordOnly({
      id: "task-plan-only",
      repo_id: repo.id,
      change_path: "docs/tasks/cli-plan-only-task",
      status: "DRAFT",
      worktree_path: null,
      ready_at: null,
    });

    const result = await reconcileRepo(repo, {
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
    });

    expect(result.removed).toBe(0);
    expect(await ctx.taskRepository.get("task-plan-only")).toMatchObject({
      status: "DRAFT",
    });
  });

  test("discovers legacy repo-local docs/tasks folders when setting is enabled", async () => {
    await ctx.settingsRepository.set("discover_legacy_repo_tasks", "true");

    const legacyDir = join(repoPath, "docs/tasks/legacy-auth-flow");
    await mkdir(legacyDir, { recursive: true });

    await writeTaskDoc(
      join(legacyDir, "task.md"),
      {
        id: "task-legacy",
        title: "Legacy Auth Flow",
        status: "DRAFT",
        created: "2026-03-12T12:00:00.000Z",
        changePath: "docs/tasks/legacy-auth-flow",
      },
      ["", "## Description", "Legacy doc", ""].join("\n"),
    );

    const result = await reconcileRepo(repo, {
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
      settingsRepository: ctx.settingsRepository,
    });

    expect(result.created).toBe(1);
    expect(result.removed).toBe(0);
    const task = await ctx.taskRepository.getByChangePath("repo-1", "docs/tasks/legacy-auth-flow");
    expect(task).toMatchObject({
      change_path: "docs/tasks/legacy-auth-flow",
    });
  });
});
