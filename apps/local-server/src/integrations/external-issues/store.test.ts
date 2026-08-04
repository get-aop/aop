import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema.ts";
import { createTestDb, createTestRepo } from "../../db/test-utils.ts";
import { createExternalIssueStore } from "./store.ts";

describe("integrations/external-issues/store", () => {
  let db: Kysely<Database>;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    await createTestRepo(db, "repo-1", "/tmp/external-issue-store-repo");
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("keeps task sources isolated by provider", async () => {
    const store = createExternalIssueStore(db);

    await store.upsertTaskSource({
      taskId: "task-linear",
      repoId: "repo-1",
      provider: "linear",
      externalId: "issue-1",
      externalRef: "ABC-1",
      externalUrl: "https://linear.app/acme/issue/ABC-1/task",
      titleSnapshot: "Linear task",
    });
    await store.upsertTaskSource({
      taskId: "task-jira",
      repoId: "repo-1",
      provider: "jira",
      externalId: "issue-1",
      externalRef: "ABC-1",
      externalUrl: "https://acme.atlassian.net/browse/ABC-1",
      titleSnapshot: "Jira task",
    });

    expect(await store.getTaskSourceByExternalId("repo-1", "linear", "issue-1")).toMatchObject({
      task_id: "task-linear",
      provider: "linear",
      external_id: "issue-1",
    });
    expect(await store.getTaskSourceByExternalId("repo-1", "jira", "issue-1")).toMatchObject({
      task_id: "task-jira",
      provider: "jira",
      external_id: "issue-1",
    });
    expect(await db.selectFrom("task_sources").selectAll().execute()).toHaveLength(2);
  });

  test("lists task sources by repo and optional provider", async () => {
    const store = createExternalIssueStore(db);

    await store.upsertTaskSource({
      taskId: "task-linear",
      repoId: "repo-1",
      provider: "linear",
      externalId: "lin-1",
      externalRef: "GET-1",
      externalUrl: "https://linear.app/get-aop/issue/GET-1/task",
      titleSnapshot: "Linear task",
    });
    await store.upsertTaskSource({
      taskId: "task-jira",
      repoId: "repo-1",
      provider: "jira",
      externalId: "jira-1",
      externalRef: "GET-2",
      externalUrl: "https://acme.atlassian.net/browse/GET-2",
      titleSnapshot: "Jira task",
    });

    expect((await store.listTaskSourcesByRepo("repo-1")).map((source) => source.provider)).toEqual([
      "jira",
      "linear",
    ]);
    expect(await store.listTaskSourcesByRepo("repo-1", ["linear"])).toMatchObject([
      {
        task_id: "task-linear",
        provider: "linear",
        external_ref: "GET-1",
      },
    ]);
  });

  test("replaces dependency edges for one provider source without removing another", async () => {
    const store = createExternalIssueStore(db);

    await store.replaceTaskDependencies({
      taskId: "task-root",
      source: "linear_blocks",
      dependsOnTaskIds: ["task-linear-blocker"],
    });
    await store.replaceTaskDependencies({
      taskId: "task-root",
      source: "jira_blocks",
      dependsOnTaskIds: ["task-jira-blocker"],
    });
    await store.replaceTaskDependencies({
      taskId: "task-root",
      source: "jira_blocks",
      dependsOnTaskIds: ["task-jira-blocker-2"],
    });

    expect(await store.listTaskDependencies("task-root")).toMatchObject([
      {
        task_id: "task-root",
        depends_on_task_id: "task-jira-blocker-2",
        source: "jira_blocks",
      },
      {
        task_id: "task-root",
        depends_on_task_id: "task-linear-blocker",
        source: "linear_blocks",
      },
    ]);
  });

  test("keeps provider-specific edges when multiple sources point to the same task", async () => {
    const store = createExternalIssueStore(db);

    await store.replaceTaskDependencies({
      taskId: "task-root",
      source: "linear_blocks",
      dependsOnTaskIds: ["task-shared-blocker"],
    });
    await store.replaceTaskDependencies({
      taskId: "task-root",
      source: "jira_blocks",
      dependsOnTaskIds: ["task-shared-blocker"],
    });

    expect(await store.listTaskDependencies("task-root")).toMatchObject([
      {
        task_id: "task-root",
        depends_on_task_id: "task-shared-blocker",
        source: "jira_blocks",
      },
      {
        task_id: "task-root",
        depends_on_task_id: "task-shared-blocker",
        source: "linear_blocks",
      },
    ]);

    await store.replaceTaskDependencies({
      taskId: "task-root",
      source: "jira_blocks",
      dependsOnTaskIds: [],
    });

    expect(await store.listTaskDependencies("task-root")).toMatchObject([
      {
        task_id: "task-root",
        depends_on_task_id: "task-shared-blocker",
        source: "linear_blocks",
      },
    ]);
  });

  test("keeps provider-specific edges when replacing reconciled dependency edges", async () => {
    const store = createExternalIssueStore(db);

    await store.replaceTaskDependencyEdges({
      taskId: "task-root",
      dependencies: [
        {
          dependsOnTaskId: "task-shared-blocker",
          source: "linear_blocks",
        },
        {
          dependsOnTaskId: "task-shared-blocker",
          source: "jira_blocks",
        },
      ],
    });

    expect(await store.listTaskDependencies("task-root")).toMatchObject([
      {
        task_id: "task-root",
        depends_on_task_id: "task-shared-blocker",
        source: "jira_blocks",
      },
      {
        task_id: "task-root",
        depends_on_task_id: "task-shared-blocker",
        source: "linear_blocks",
      },
    ]);
  });
});
