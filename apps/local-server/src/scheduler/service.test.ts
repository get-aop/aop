import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { SettingKey } from "../settings/types.ts";
import { serializeFrontmatter } from "../task-docs/frontmatter.ts";
import { resolveTaskDir } from "../task-docs/paths.ts";

describe("SchedulerService", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/repo-1");
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("creates and retrieves a scheduler trigger", async () => {
    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "nightly-promote",
      action: "auto_promote_draft_to_ready",
      cadenceSecs: 3600,
      maxItemsPerRun: 3,
    });

    expect(trigger.id).toBeDefined();
    expect(trigger.enabled).toBe(false);

    const list = await ctx.schedulerService.listTriggers("repo-1");
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("nightly-promote");
  });

  test("updates a scheduler trigger", async () => {
    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "hourly-import",
      action: "re_import_tracker",
      cadenceSecs: 3600,
      maxItemsPerRun: 5,
    });

    const updated = await ctx.schedulerService.updateTrigger(trigger.id, {
      enabled: true,
      cadenceSecs: 1800,
    });

    expect(updated?.enabled).toBe(true);
    expect(updated?.cadence_secs).toBe(1800);
  });

  test("re-import trigger delegates to the tracker reimporter with allowed sources", async () => {
    await ctx.settingsRepository.set(SettingKey.SCHEDULER_ENABLED, "true");
    const calls: Array<{ repoId: string; allowedSources: string[] | null }> = [];
    ctx.trackerReimporter = {
      reimportRepo: async (input) => {
        calls.push(input);
        return { imported: 2, skipped: 1, failures: [] };
      },
    };

    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "re-import-linear",
      action: "re_import_tracker",
      cadenceSecs: 60,
      maxItemsPerRun: 10,
      enabled: true,
      allowedSources: ["linear"],
    });

    const result = await ctx.schedulerService.runTrigger(trigger.id);

    expect(calls).toEqual([{ repoId: "repo-1", allowedSources: ["linear"] }]);
    expect(result).toMatchObject({
      action: "re_import_tracker",
      imported: 2,
      skipped: 1,
    });
  });

  test("deletes a scheduler trigger", async () => {
    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "temp",
      action: "auto_promote_draft_to_ready",
      cadenceSecs: 60,
      maxItemsPerRun: 1,
    });

    await ctx.schedulerService.deleteTrigger(trigger.id);
    const list = await ctx.schedulerService.listTriggers("repo-1");
    expect(list).toHaveLength(0);
  });

  test("auto-promote promotes at most maxItemsPerRun eligible DRAFT tasks", async () => {
    await ctx.settingsRepository.set(SettingKey.SCHEDULER_ENABLED, "true");
    const agent = await createAgent(ctx, "agent-1", "repo-1");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    for (let i = 0; i < 5; i++) {
      const task = await ctx.taskRepository.create({
        id: `task-${i}`,
        repo_id: "repo-1",
        change_path: `docs/tasks/task-${i}`,
        status: "DRAFT",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await ctx.taskAssignmentRepository.upsertCurrent({
        taskId: task.id,
        agentId: agent.id,
        repoId: "repo-1",
        statusColumn: "DRAFT",
      });
      const taskDir = join("/tmp/repo-1", `docs/tasks/task-${i}`);
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(join(taskDir, "task.md"), "# Task\n\n## Description\nTest task");
    }

    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "promote-3",
      action: "auto_promote_draft_to_ready",
      cadenceSecs: 60,
      maxItemsPerRun: 3,
      enabled: true,
    });

    const result = await ctx.schedulerService.runTrigger(trigger.id);

    expect(result.promoted).toBe(3);
    expect(result.skipped).toBe(2);
  });

  test("auto-promote stamps the trigger handoff approval policy on promoted tasks", async () => {
    await ctx.settingsRepository.set(SettingKey.SCHEDULER_ENABLED, "true");
    const agent = await createAgent(ctx, "agent-policy", "repo-1");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const task = await ctx.taskRepository.create({
      id: "task-policy",
      repo_id: "repo-1",
      change_path: "docs/tasks/task-policy",
      status: "DRAFT",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await ctx.taskAssignmentRepository.upsertCurrent({
      taskId: task.id,
      agentId: agent.id,
      repoId: "repo-1",
      statusColumn: "DRAFT",
    });
    const taskDir = join("/tmp/repo-1", "docs/tasks/task-policy");
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, "task.md"), "# Task\n\n## Description\nTest task");

    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "promote-without-handoff-approval",
      action: "auto_promote_draft_to_ready",
      cadenceSecs: 60,
      maxItemsPerRun: 1,
      enabled: true,
      requireApprovalBeforeHandoff: false,
    });

    const result = await ctx.schedulerService.runTrigger(trigger.id);
    const promoted = await ctx.taskRepository.get("task-policy");

    expect(result.promoted).toBe(1);
    expect(promoted?.handoff_requires_approval_override).toBe(false);
  });

  test("auto-promote skips tasks marked as high risk", async () => {
    await ctx.settingsRepository.set(SettingKey.SCHEDULER_ENABLED, "true");
    const agent = await createAgent(ctx, "agent-risk", "repo-1");

    const task = await ctx.taskRepository.create({
      id: "task-risk",
      repo_id: "repo-1",
      change_path: "docs/tasks/security-token-rotation",
      status: "DRAFT",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await ctx.taskAssignmentRepository.upsertCurrent({
      taskId: task.id,
      agentId: agent.id,
      repoId: "repo-1",
      statusColumn: "DRAFT",
    });
    await writeSchedulerTaskDoc(ctx, task, { tags: ["high-risk"] });

    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "promote-safe-only",
      action: "auto_promote_draft_to_ready",
      cadenceSecs: 60,
      maxItemsPerRun: 5,
      enabled: true,
    });

    const result = await ctx.schedulerService.runTrigger(trigger.id);
    const skippedTask = await ctx.taskRepository.get(task.id);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(skippedTask?.status).toBe("DRAFT");
  });

  test("auto-promote skips tasks without worker assignment", async () => {
    await ctx.settingsRepository.set(SettingKey.SCHEDULER_ENABLED, "true");

    await ctx.taskRepository.create({
      id: "task-unassigned",
      repo_id: "repo-1",
      change_path: "docs/tasks/task-unassigned",
      status: "DRAFT",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "promote",
      action: "auto_promote_draft_to_ready",
      cadenceSecs: 60,
      maxItemsPerRun: 5,
      enabled: true,
    });

    const result = await ctx.schedulerService.runTrigger(trigger.id);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test("does not run triggers when scheduler is disabled", async () => {
    await ctx.settingsRepository.set(SettingKey.SCHEDULER_ENABLED, "false");

    const trigger = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "disabled",
      action: "auto_promote_draft_to_ready",
      cadenceSecs: 60,
      maxItemsPerRun: 1,
      enabled: true,
    });

    const result = await ctx.schedulerService.runTrigger(trigger.id);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.reason).toBe("scheduler_disabled");
  });

  test("getDueTriggers returns triggers whose cadence has elapsed", async () => {
    await ctx.settingsRepository.set(SettingKey.SCHEDULER_ENABLED, "true");

    const due = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "due-trigger",
      action: "auto_promote_draft_to_ready",
      cadenceSecs: 1,
      maxItemsPerRun: 1,
      enabled: true,
    });
    const notDue = await ctx.schedulerService.createTrigger({
      repoId: "repo-1",
      name: "not-due",
      action: "auto_promote_draft_to_ready",
      cadenceSecs: 9999,
      maxItemsPerRun: 1,
      enabled: true,
    });
    await db
      .updateTable("scheduler_triggers")
      .set({ last_run_at: new Date().toISOString() })
      .where("id", "=", notDue.id)
      .execute();

    await db
      .updateTable("scheduler_triggers")
      .set({ last_run_at: new Date(Date.now() - 5000).toISOString() })
      .where("id", "=", due.id)
      .execute();

    const dueTriggers = await ctx.schedulerService.getDueTriggers();
    expect(dueTriggers.map((t) => t.name)).toContain("due-trigger");
    expect(dueTriggers.map((t) => t.name)).not.toContain("not-due");
  });
});

const createAgent = async (ctx: LocalServerContext, agentId: string, repoId: string) => {
  const now = new Date().toISOString();
  await db_insertAgent(ctx, agentId, repoId, now);
  return { id: agentId };
};

const db_insertAgent = async (
  ctx: LocalServerContext,
  agentId: string,
  repoId: string,
  now: string,
) => {
  await ctx.db
    .insertInto("agents")
    .values({
      id: agentId,
      name: agentId,
      role: "developer",
      runtime_provider: "hermes",
      provider: "openai-codex",
      model: "gpt-5.4",
      workflow_id: "simple",
      status: "active",
      artifact_path: `/tmp/.aop/agents/${agentId}`,
      source_kind: "manual",
      source_ref: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  await ctx.db
    .insertInto("agent_repo_memberships")
    .values({
      agent_id: agentId,
      repo_id: repoId,
      membership_role: "primary",
      created_at: now,
    })
    .execute();
};

const writeSchedulerTaskDoc = async (
  ctx: LocalServerContext,
  task: Task,
  options: { tags?: string[] } = {},
): Promise<void> => {
  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) throw new Error(`Repo ${task.repo_id} not found`);

  const taskDir = resolveTaskDir(task.repo_id, repo.path, task.change_path);
  await mkdir(taskDir, { recursive: true });
  await Bun.write(
    join(taskDir, "task.md"),
    serializeFrontmatter({
      frontmatter: {
        id: task.id,
        title: task.id,
        status: task.status,
        created: task.created_at,
        changePath: task.change_path,
        tags: options.tags ?? [],
      },
      content: [
        "",
        "## Description",
        task.id,
        "",
        "## Requirements",
        "",
        "## Acceptance Criteria",
        "- [ ] Review before promotion",
        "",
      ].join("\n"),
    }),
  );
};
