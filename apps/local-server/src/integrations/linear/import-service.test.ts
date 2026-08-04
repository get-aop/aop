import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database } from "../../db/schema.ts";
import { createTestDb } from "../../db/test-utils.ts";
import { initRepo } from "../../repo/handlers.ts";
import { getServerStatus } from "../../status/handlers.ts";
import { createLinearImportService } from "./import-service.ts";

const AGENT_ID = "agent-linear-import";

describe("integrations/linear/import-service", () => {
  let cleanupAopHome: (() => void) | undefined;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = await mkdtemp(join(tmpdir(), "aop-linear-import-service-"));
    await Bun.$`git init -b main ${repoPath}`.quiet();
    await Bun.$`git -C ${repoPath} config user.email aop-tests@example.com`.quiet();
    await Bun.$`git -C ${repoPath} config user.name "AOP Tests"`.quiet();
  });

  afterEach(async () => {
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
    cleanupAopHome?.();
  });

  test("imports Linear issues as assigned DRAFT tasks with ticket-derived issues.md", async () => {
    const repoId = await registerRepoAndAgent();
    const service = createLinearImportService({
      ctx,
      createClient: () =>
        ({
          getIssuesByRefs: async (refs: string[]) =>
            refs.map((ref) => ({
              id: `lin_${ref.toLowerCase().replace("-", "_")}`,
              identifier: ref,
              title: ref === "GET-41" ? "Dashboard Scroll" : "Unknown",
              url: `https://linear.app/get-aop/issue/${ref}/dashboard-scroll`,
              description: "We can't scroll to bottom on dashboard; the image gets stuck and cut.",
              priority: 2,
              state: { name: "Todo", type: "unstarted" },
              team: { key: "GET", name: "Get AOP" },
              project: { name: "AOP" },
              relations: { nodes: [] },
            })),
        }) as never,
    });

    const result = await service.importFromInput({
      cwd: repoPath,
      input: "GET-41",
      agentId: AGENT_ID,
    });

    expect(result.alreadyExists).toBe(true);
    expect(result.repoId).toBe(repoId);
    expect(result.failures).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({
      ref: "GET-41",
      changePath: "docs/tasks/get-41-dashboard-scroll",
      requested: true,
      dependencyImported: false,
    });

    const publishedTaskDir = aopPaths.repoTask(repoId, "get-41-dashboard-scroll");

    const issuesContent = await Bun.file(join(publishedTaskDir, "issues.md")).text();
    const taskFiles = await readdir(publishedTaskDir);
    const serverTasks = (await getServerStatus(ctx)).repos[0]?.tasks ?? [];
    const assignment = await ctx.taskAssignmentRepository.getCurrentByTaskId(
      result.imported[0]?.taskId ?? "",
    );

    expect(issuesContent).toContain("# GET-41: Dashboard Scroll");
    expect(issuesContent).toContain("We can't scroll to bottom on dashboard");
    expect(taskFiles.sort()).toEqual(["issues.md", "task.md"]);
    expect(taskFiles.some((file) => /^\d{3}-.*\.md$/.test(file))).toBe(false);
    expect(serverTasks).toHaveLength(1);
    expect(serverTasks[0]?.status).toBe("DRAFT");
    expect(assignment?.agent_id).toBe(AGENT_ID);
  });

  test("publishes requested tasks and imported blockers together as assigned DRAFT tasks", async () => {
    await registerRepoAndAgent();
    const service = createLinearImportService({
      ctx,
      createClient: () =>
        ({
          getIssuesByRefs: async (refs: string[]) =>
            refs.flatMap((ref: string) => {
              if (ref === "GET-203") {
                return [
                  {
                    id: "lin_get_203",
                    identifier: "GET-203",
                    title: "Create dependent output",
                    url: "https://linear.app/get-aop/issue/GET-203/create-dependent-output",
                    relations: { nodes: [] },
                    inverseRelations: {
                      nodes: [
                        {
                          type: "blocks",
                          issue: {
                            id: "lin_get_202",
                            identifier: "GET-202",
                            title: "Create blocker output",
                            url: "https://linear.app/get-aop/issue/GET-202/create-blocker-output",
                          },
                        },
                      ],
                    },
                  },
                ];
              }

              if (ref === "GET-202") {
                return [
                  {
                    id: "lin_get_202",
                    identifier: "GET-202",
                    title: "Create blocker output",
                    url: "https://linear.app/get-aop/issue/GET-202/create-blocker-output",
                    relations: { nodes: [] },
                  },
                ];
              }

              return [];
            }),
        }) as never,
    });

    const result = await service.importFromInput({
      cwd: repoPath,
      input: "GET-203",
      agentId: AGENT_ID,
    });

    expect(result.imported).toHaveLength(2);
    expect(result.imported.find((record) => record.ref === "GET-203")?.requested).toBe(true);
    expect(result.imported.find((record) => record.ref === "GET-202")?.dependencyImported).toBe(
      true,
    );

    const requestedTaskDir = aopPaths.repoTask(result.repoId, "get-203-create-dependent-output");
    const blockerTaskDir = aopPaths.repoTask(result.repoId, "get-202-create-blocker-output");

    const serverTasks = (await getServerStatus(ctx)).repos[0]?.tasks ?? [];
    const assignments = await Promise.all(
      result.imported.map((record) =>
        ctx.taskAssignmentRepository.getCurrentByTaskId(record.taskId),
      ),
    );

    expect(serverTasks).toHaveLength(2);
    expect(serverTasks.every((task) => task.status === "DRAFT")).toBe(true);
    expect(await Bun.file(join(requestedTaskDir, "issues.md")).exists()).toBe(true);
    expect(await Bun.file(join(blockerTaskDir, "issues.md")).exists()).toBe(true);
    expect(await Bun.file(join(requestedTaskDir, "plan.md")).exists()).toBe(false);
    expect(await Bun.file(join(blockerTaskDir, "plan.md")).exists()).toBe(false);
    expect(await Bun.file(join(requestedTaskDir, "task.md")).exists()).toBe(true);
    expect(await Bun.file(join(blockerTaskDir, "task.md")).exists()).toBe(true);
    expect(assignments.every((assignment) => assignment?.agent_id === AGENT_ID)).toBe(true);
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
