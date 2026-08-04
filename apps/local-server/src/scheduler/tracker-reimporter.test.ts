import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import type { LinearResolvedIssue } from "../integrations/linear/types.ts";
import { createTrackerReimporter } from "./tracker-reimporter.ts";

describe("tracker reimporter", () => {
  let cleanupAopHome: () => void;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/repo-1");
    await createAgent(ctx, "agent-1", "repo-1");
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("re-imports existing Linear task sources without duplicating tasks", async () => {
    await ctx.taskRepository.create({
      id: "task-existing",
      repo_id: "repo-1",
      change_path: "docs/tasks/get-1-original-title",
      status: "DRAFT",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await ctx.taskAssignmentRepository.upsertCurrent({
      taskId: "task-existing",
      agentId: "agent-1",
      repoId: "repo-1",
      statusColumn: "DRAFT",
    });
    await ctx.externalIssueStore.upsertTaskSource({
      taskId: "task-existing",
      repoId: "repo-1",
      provider: "linear",
      externalId: "lin_get_1",
      externalRef: "GET-1",
      externalUrl: "https://linear.app/get-aop/issue/GET-1/original-title",
      titleSnapshot: "Original title",
    });

    let title = "Updated title";
    const reimporter = createTrackerReimporter({
      ctx,
      resolveLinearIssuesByRefs: async (refs) =>
        refs.map((ref) => buildLinearIssue({ ref, id: "lin_get_1", title })),
    });

    expect(
      await reimporter.reimportRepo({ repoId: "repo-1", allowedSources: ["linear"] }),
    ).toMatchObject({
      imported: 1,
      skipped: 0,
      failures: [],
    });

    title = "Updated title again";
    expect(
      await reimporter.reimportRepo({ repoId: "repo-1", allowedSources: ["linear"] }),
    ).toMatchObject({
      imported: 1,
      skipped: 0,
      failures: [],
    });

    const tasks = await ctx.taskRepository.list({ repo_id: "repo-1" });
    const source = await ctx.externalIssueStore.getTaskSourceByTaskId("task-existing");

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("task-existing");
    expect(source).toMatchObject({
      task_id: "task-existing",
      title_snapshot: "Updated title again",
    });
  });
});

const buildLinearIssue = (params: {
  id: string;
  ref: string;
  title: string;
}): LinearResolvedIssue => ({
  id: params.id,
  ref: params.ref,
  title: params.title,
  url: `https://linear.app/get-aop/issue/${params.ref}/task`,
  blocks: [],
  description: "Re-imported issue body",
  priority: 3,
  state: { name: "Todo", type: "unstarted" },
  project: { name: "AOP" },
  team: { key: "GET", name: "Get AOP" },
});

const createAgent = async (
  ctx: LocalServerContext,
  agentId: string,
  repoId: string,
): Promise<void> => {
  const now = new Date().toISOString();
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
