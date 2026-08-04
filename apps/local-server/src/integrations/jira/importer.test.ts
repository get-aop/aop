import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database } from "../../db/schema.ts";
import { createTestDb, createTestRepo } from "../../db/test-utils.ts";
import { parseTaskDoc, writeTaskDoc } from "../../task-docs/task.ts";

interface JiraIssueSummary {
  id: string;
  key: string;
  ref: string;
  title: string;
  url: string;
}

interface JiraResolvedIssue extends JiraIssueSummary {
  blocks: JiraIssueSummary[];
  description: string | null;
  priority: { id: string | null; name: string } | null;
  status: { id: string | null; name: string; category: string | null } | null;
  project: { id: string | null; key: string; name: string } | null;
  team: { id: string | null; name: string } | null;
}

interface JiraImporterModule {
  createJiraImporter(options: {
    repoRepository: LocalServerContext["repoRepository"];
    taskRepository: LocalServerContext["taskRepository"];
    externalIssueStore: LocalServerContext["externalIssueStore"];
    ctx?: LocalServerContext;
    resolveIssuesByRefs(refs: string[]): Promise<JiraResolvedIssue[]>;
  }): {
    importIssues(params: {
      repoId: string;
      issues: JiraResolvedIssue[];
      agentId: string;
    }): Promise<{
      imported: Array<{
        taskId: string;
        ref: string;
        changePath: string;
        requested: boolean;
        dependencyImported: boolean;
      }>;
      failures: Array<{
        ref: string;
        error: string;
      }>;
    }>;
  };
}

type ImportResult = Awaited<
  ReturnType<ReturnType<JiraImporterModule["createJiraImporter"]>["importIssues"]>
>;

const loadImporterModule = async (): Promise<JiraImporterModule> =>
  (await import("./importer.ts")) as JiraImporterModule;

const AGENT_ID = "agent-jira-importer";

const getImportedRecord = (result: ImportResult, ref: string) => {
  const record = result.imported.find((item) => item.ref === ref);
  if (!record) {
    throw new Error(`Missing imported record for ${ref}`);
  }
  return record;
};

const createIssue = (
  ref: string,
  title: string,
  blocks: JiraIssueSummary[] = [],
): JiraResolvedIssue => ({
  id: `jira_${ref.toLowerCase().replace("-", "_")}`,
  key: ref,
  ref,
  title,
  url: `https://acme.atlassian.net/browse/${ref}`,
  blocks,
  description: null,
  priority: null,
  status: null,
  project: null,
  team: null,
});

describe("integrations/jira/importer", () => {
  let cleanupAopHome: (() => void) | undefined;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = join(tmpdir(), `aop-jira-importer-${Date.now()}`);
    await createTestRepo(db, "repo-1", repoPath);
    await createAgentForRepo("repo-1");
  });

  afterEach(async () => {
    cleanupAopHome?.();
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  const createAgentForRepo = async (repoId: string): Promise<void> => {
    const workflowId = `workflow-${AGENT_ID}`;
    const now = new Date().toISOString();
    await db
      .insertInto("workflows")
      .values({ id: workflowId, name: workflowId, definition: "{}" })
      .execute();
    await db
      .insertInto("agents")
      .values({
        id: AGENT_ID,
        name: AGENT_ID,
        role: "developer",
        runtime_provider: "hermes",
        provider: "openai-codex",
        model: "gpt-5.4",
        workflow_id: workflowId,
        status: "active",
        artifact_path: `/tmp/.aop/agents/${AGENT_ID}`,
        source_kind: "manual",
        source_ref: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto("agent_repo_memberships")
      .values({
        agent_id: AGENT_ID,
        repo_id: repoId,
        membership_role: "primary",
        created_at: now,
      })
      .execute();
  };

  test("imports a Jira issue into a task doc with Jira source metadata", async () => {
    const { createJiraImporter } = await loadImporterModule();
    const importer = createJiraImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
      ctx,
      resolveIssuesByRefs: async () => [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      agentId: AGENT_ID,
      issues: [
        {
          ...createIssue("GET-50", "Backlog Jira Parity"),
          description: "Add Jira issue ingestion with planning parity.",
          priority: { id: "2", name: "High" },
          status: { id: "3", name: "In Progress", category: "In Progress" },
          project: { id: "10000", key: "GET", name: "Get AOP" },
          team: { id: "team-1", name: "Factory Team" },
        },
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.imported).toHaveLength(1);
    const imported = getImportedRecord(result, "GET-50");

    expect(imported).toMatchObject({
      ref: "GET-50",
      requested: true,
      dependencyImported: false,
      changePath: "docs/tasks/get-50-backlog-jira-parity",
    });

    const taskDir = aopPaths.repoTask("repo-1", "get-50-backlog-jira-parity");
    const taskDocPath = join(taskDir, "task.md");
    const taskDoc = await parseTaskDoc(taskDocPath);
    const rawTaskDoc = await Bun.file(taskDocPath).text();
    const issuesMd = await Bun.file(join(taskDir, "issues.md")).text();
    const storedTask = await ctx.taskRepository.get(imported.taskId);

    expect(taskDoc.title).toBe("Backlog Jira Parity");
    expect(taskDoc.source).toEqual({
      provider: "jira",
      id: "jira_get_50",
      ref: "GET-50",
      url: "https://acme.atlassian.net/browse/GET-50",
    });
    expect(taskDoc.description).toContain("Provider: Jira");
    expect(taskDoc.description).toContain("Issue ref: GET-50");
    expect(taskDoc.description).toContain("Add Jira issue ingestion with planning parity.");
    expect(taskDoc.requirements).toContain("Review `issues.md`; it was derived from Jira.");
    expect(taskDoc.requirements).toContain(
      "Use `task.md` for source metadata and `issues.md` for the implementation plan.",
    );
    expect(taskDoc.acceptanceCriteria).toEqual([
      { text: "Complete the imported work described in `issues.md`.", checked: false },
    ]);
    expect(issuesMd).toContain("# GET-50: Backlog Jira Parity");
    expect(issuesMd).toContain("## Agent Brief");
    expect(issuesMd).toContain("Add Jira issue ingestion with planning parity.");
    expect(await Bun.file(join(taskDir, "plan.md")).exists()).toBe(false);
    expect(rawTaskDoc).toContain("priority: high");
    expect(rawTaskDoc).toContain("  - jira");
    expect(rawTaskDoc).toContain("  - get");
    expect(rawTaskDoc).toContain("  - aop");
    expect(rawTaskDoc).toContain("Team: Factory Team");
    expect(rawTaskDoc).toContain("Project: Get AOP (GET)");
    expect(rawTaskDoc).toContain("Status: In Progress");
    expect(rawTaskDoc).toContain("Priority: High");
    expect(storedTask?.change_path).toBe("docs/tasks/get-50-backlog-jira-parity");
    expect(storedTask?.status).toBe("DRAFT");
    expect(await ctx.taskAssignmentRepository.getCurrentByTaskId(imported.taskId)).toMatchObject({
      agent_id: AGENT_ID,
    });

    expect(
      await ctx.externalIssueStore.getTaskSourceByExternalId("repo-1", "jira", "jira_get_50"),
    ).toMatchObject({
      task_id: imported.taskId,
      provider: "jira",
      external_ref: "GET-50",
      title_snapshot: "Backlog Jira Parity",
    });
  });

  test("auto-imports Jira blockers as dependency-imported tasks and mirrors dependency edges", async () => {
    const { createJiraImporter } = await loadImporterModule();
    const importer = createJiraImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
      ctx,
      resolveIssuesByRefs: async (refs) =>
        refs.includes("GET-49") ? [createIssue("GET-49", "Finish Linear Import")] : [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      agentId: AGENT_ID,
      issues: [
        createIssue("GET-50", "Backlog Jira Parity", [
          {
            id: "jira_get_49",
            key: "GET-49",
            ref: "GET-49",
            title: "Finish Linear Import",
            url: "https://acme.atlassian.net/browse/GET-49",
          },
        ]),
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.imported).toHaveLength(2);
    expect(result.imported.find((item) => item.ref === "GET-49")).toMatchObject({
      requested: false,
      dependencyImported: true,
    });

    const rootTask = getImportedRecord(result, "GET-50");
    const blockerTask = getImportedRecord(result, "GET-49");

    const rootDoc = await parseTaskDoc(
      join(aopPaths.repoTask("repo-1", "get-50-backlog-jira-parity"), "task.md"),
    );
    const blockerDoc = await parseTaskDoc(
      join(aopPaths.repoTask("repo-1", "get-49-finish-linear-import"), "task.md"),
    );

    expect(rootDoc.dependencySources).toEqual([
      {
        provider: "jira",
        id: "jira_get_49",
        ref: "GET-49",
      },
    ]);
    expect(blockerDoc.dependencyImported).toBe(true);
    expect(await ctx.externalIssueStore.listTaskDependencies(rootTask.taskId)).toMatchObject([
      {
        task_id: rootTask.taskId,
        depends_on_task_id: blockerTask.taskId,
        source: "jira_blocks",
      },
    ]);
  });

  test("reuses an existing task when a Jira import collides with its change path", async () => {
    const { createJiraImporter } = await loadImporterModule();
    await ctx.taskRepository.create({
      id: "task-existing",
      repo_id: "repo-1",
      change_path: "docs/tasks/get-50-backlog-jira-parity",
      status: "DRAFT",
      worktree_path: null,
      ready_at: null,
    });
    const importer = createJiraImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
      ctx,
      resolveIssuesByRefs: async () => [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      agentId: AGENT_ID,
      issues: [createIssue("GET-50", "Backlog Jira Parity")],
    });

    const imported = getImportedRecord(result, "GET-50");
    const taskDocPath = join(aopPaths.repoTask("repo-1", "get-50-backlog-jira-parity"), "task.md");
    const taskDoc = await parseTaskDoc(taskDocPath);

    expect(imported.taskId).toBe("task-existing");
    expect(taskDoc.id).toBe("task-existing");
    expect(
      await ctx.externalIssueStore.getTaskSourceByExternalId("repo-1", "jira", "jira_get_50"),
    ).toMatchObject({
      task_id: "task-existing",
      external_ref: "GET-50",
    });
  });

  test("preserves existing task status when importing into a legacy repo-local task", async () => {
    const { createJiraImporter } = await loadImporterModule();
    const legacyTaskDir = join(repoPath, "docs/tasks/get-50-backlog-jira-parity");
    await mkdir(legacyTaskDir, { recursive: true });
    await writeTaskDoc(
      join(legacyTaskDir, "task.md"),
      {
        id: "task-existing",
        title: "Existing Jira parity task",
        status: "READY",
        created: "2026-01-01T00:00:00.000Z",
        changePath: "docs/tasks/get-50-backlog-jira-parity",
      },
      "## Description\nExisting task details.\n",
    );
    const now = new Date().toISOString();
    await db
      .insertInto("tasks")
      .values({
        id: "task-existing",
        repo_id: "repo-1",
        change_path: "docs/tasks/get-50-backlog-jira-parity",
        status: "READY",
        worktree_path: null,
        ready_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await ctx.taskRepository.refresh();
    const importer = createJiraImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
      ctx,
      resolveIssuesByRefs: async () => [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      agentId: AGENT_ID,
      issues: [createIssue("GET-50", "Backlog Jira Parity")],
    });

    const imported = getImportedRecord(result, "GET-50");
    const taskDocPath = join(aopPaths.repoTask("repo-1", "get-50-backlog-jira-parity"), "task.md");
    const taskDoc = await parseTaskDoc(taskDocPath);
    const storedTask = await ctx.taskRepository.get("task-existing");

    expect(imported.taskId).toBe("task-existing");
    expect(taskDoc.status).toBe("READY");
    expect(taskDoc.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(storedTask?.status).toBe("READY");
  });

  test("reports a per-ticket failure when a required Jira blocker cannot be resolved", async () => {
    const { createJiraImporter } = await loadImporterModule();
    const importer = createJiraImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      externalIssueStore: ctx.externalIssueStore,
      ctx,
      resolveIssuesByRefs: async () => [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      agentId: AGENT_ID,
      issues: [
        createIssue("GET-50", "Backlog Jira Parity", [
          {
            id: "jira_get_49",
            key: "GET-49",
            ref: "GET-49",
            title: "Finish Linear Import",
            url: "https://acme.atlassian.net/browse/GET-49",
          },
        ]),
      ],
    });

    expect(result.imported).toEqual([]);
    expect(result.failures).toEqual([
      {
        ref: "GET-50",
        error: "Missing Jira blockers: GET-49",
      },
    ]);
    expect(await readdir(join(repoPath, "docs/tasks")).catch(() => [])).toEqual([]);
  });
});
