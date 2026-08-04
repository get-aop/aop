import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database } from "../../db/schema.ts";
import { createTestDb } from "../../db/test-utils.ts";
import { initRepo } from "../../repo/handlers.ts";
import { getServerStatus } from "../../status/handlers.ts";
import { createJiraImportService } from "./import-service.ts";

const AGENT_ID = "agent-jira-import";

describe("integrations/jira/import-service", () => {
  let cleanupAopHome: (() => void) | undefined;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = await mkdtemp(join(tmpdir(), "aop-jira-import-service-"));
    await Bun.$`git init -b main ${repoPath}`.quiet();
    await Bun.$`git -C ${repoPath} config user.email aop-tests@example.com`.quiet();
    await Bun.$`git -C ${repoPath} config user.name "AOP Tests"`.quiet();
  });

  afterEach(async () => {
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
    cleanupAopHome?.();
  });

  test("imports Jira issues as assigned DRAFT tasks with ticket-derived issues.md", async () => {
    const repoId = await registerRepoAndAgent();
    const service = createJiraImportService({
      ctx,
      createClient: () =>
        ({
          getIssuesByKeys: async (keys: string[]) =>
            keys.map((key) =>
              buildIssue({
                id: `jira_${key.toLowerCase().replace("-", "_")}`,
                key,
                summary: key === "GET-50" ? "Backlog Jira Parity" : "Unknown",
                description: "Move Jira imported tickets straight into assigned draft cards.",
              }),
            ),
          testConnection: async () => ({
            ok: true,
            siteUrl: "https://acme.atlassian.net",
            accountId: "acc-1",
            accountDisplayName: "Test User",
            accountEmail: "test@example.com",
          }),
        }) as never,
    });

    const result = await service.importFromInput({
      cwd: repoPath,
      input: "GET-50",
      agentId: AGENT_ID,
    });

    expect(result.alreadyExists).toBe(true);
    expect(result.repoId).toBe(repoId);
    expect(result.failures).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({
      ref: "GET-50",
      changePath: "docs/tasks/get-50-backlog-jira-parity",
      requested: true,
      dependencyImported: false,
    });

    const publishedTaskDir = aopPaths.repoTask(repoId, "get-50-backlog-jira-parity");

    const taskFiles = await Array.fromAsync(new Bun.Glob("*.md").scan(publishedTaskDir));
    const issuesContent = await Bun.file(join(publishedTaskDir, "issues.md")).text();
    const serverTasks = (await getServerStatus(ctx)).repos[0]?.tasks ?? [];
    const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(
      result.imported[0]?.taskId ?? "",
    );

    expect(issuesContent).toContain("# GET-50: Backlog Jira Parity");
    expect(issuesContent).toContain(
      "Move Jira imported tickets straight into assigned draft cards.",
    );
    expect(taskFiles.sort()).toEqual(["issues.md", "task.md"]);
    expect(taskFiles.some((file) => /^\d{3}-.*\.md$/.test(file))).toBe(false);
    expect(serverTasks).toHaveLength(1);
    expect(serverTasks[0]?.status).toBe("DRAFT");
    expect(serverTasks[0]?.sourceProvider).toBe("jira");
    expect(assignment?.agent_id).toBe(AGENT_ID);
  });

  const registerRepoAndAgent = async (): Promise<string> => {
    const result = await initRepo(ctx, repoPath);
    if (!result.success) {
      throw new Error(`Expected repo to register: ${result.error.code}`);
    }
    await createAgentForRepo(AGENT_ID, result.repoId);
    return result.repoId;
  };

  const createAgentForRepo = async (agentId: string, repoId: string): Promise<void> => {
    const workflowId = `workflow-${agentId}`;
    const now = new Date().toISOString();
    await db
      .insertInto("workflows")
      .values({ id: workflowId, name: workflowId, definition: "{}" })
      .execute();
    await db
      .insertInto("agents")
      .values({
        id: agentId,
        name: agentId,
        role: "developer",
        runtime_provider: "hermes",
        provider: "openai-codex",
        model: "gpt-5.4",
        workflow_id: workflowId,
        status: "active",
        artifact_path: `/tmp/.aop/agents/${agentId}`,
        source_kind: "manual",
        source_ref: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto("agent_repo_memberships")
      .values({
        agent_id: agentId,
        repo_id: repoId,
        membership_role: "primary",
        created_at: now,
      })
      .execute();
  };
});

const buildIssue = (params: {
  id: string;
  key: string;
  summary: string;
  description?: string | null;
}) => ({
  id: params.id,
  key: params.key,
  self: `https://acme.atlassian.net/rest/api/3/issue/${params.id}`,
  browseUrl: `https://acme.atlassian.net/browse/${params.key}`,
  fields: {
    summary: params.summary,
    description: params.description ?? null,
    priority: null,
    status: null,
    project: { id: "10000", key: "GET", name: "Get AOP" },
    issuelinks: [],
  },
});
