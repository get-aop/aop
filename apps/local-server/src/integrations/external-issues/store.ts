import type { Kysely } from "kysely";
import type { Database, TaskDependency, TaskSource } from "../../db/schema.ts";

export interface UpsertTaskSourceInput {
  taskId: string;
  repoId: string;
  provider: string;
  externalId: string;
  externalRef: string;
  externalUrl: string;
  titleSnapshot: string;
}

export interface ReplaceTaskDependenciesInput {
  taskId: string;
  source: string;
  dependsOnTaskIds: string[];
}

export interface ReplaceTaskDependencyEdgesInput {
  taskId: string;
  dependencies: Array<{
    source: string;
    dependsOnTaskId: string;
  }>;
}

export interface ExternalIssueStore {
  upsertTaskSource(input: UpsertTaskSourceInput): Promise<void>;
  getTaskSourceByExternalId(
    repoId: string,
    provider: string,
    externalId: string,
  ): Promise<TaskSource | null>;
  getTaskSourceByExternalRef(
    repoId: string,
    provider: string,
    externalRef: string,
  ): Promise<TaskSource | null>;
  getTaskSourceByTaskId(taskId: string): Promise<TaskSource | null>;
  listTaskSourcesByRepo(repoId: string, providers?: string[]): Promise<TaskSource[]>;
  replaceTaskDependencies(input: ReplaceTaskDependenciesInput): Promise<void>;
  replaceTaskDependencyEdges(input: ReplaceTaskDependencyEdgesInput): Promise<void>;
  listTaskDependencies(taskId: string): Promise<TaskDependency[]>;
}

export const getExternalIssueDependencySource = (provider: string): string => `${provider}_blocks`;

export const createExternalIssueStore = (db: Kysely<Database>): ExternalIssueStore => ({
  upsertTaskSource: async (input: UpsertTaskSourceInput): Promise<void> => {
    const updatedAt = new Date().toISOString();

    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("task_sources")
        .where("task_id", "=", input.taskId)
        .where("provider", "=", input.provider)
        .where("external_id", "!=", input.externalId)
        .execute();

      await trx
        .insertInto("task_sources")
        .values({
          task_id: input.taskId,
          repo_id: input.repoId,
          provider: input.provider,
          external_id: input.externalId,
          external_ref: input.externalRef,
          external_url: input.externalUrl,
          title_snapshot: input.titleSnapshot,
          created_at: updatedAt,
          updated_at: updatedAt,
        })
        .onConflict((oc) =>
          oc.columns(["repo_id", "provider", "external_id"]).doUpdateSet({
            task_id: input.taskId,
            external_ref: input.externalRef,
            external_url: input.externalUrl,
            title_snapshot: input.titleSnapshot,
            updated_at: updatedAt,
          }),
        )
        .execute();
    });
  },

  getTaskSourceByExternalId: async (
    repoId: string,
    provider: string,
    externalId: string,
  ): Promise<TaskSource | null> =>
    (await db
      .selectFrom("task_sources")
      .selectAll()
      .where("repo_id", "=", repoId)
      .where("provider", "=", provider)
      .where("external_id", "=", externalId)
      .executeTakeFirst()) ?? null,

  getTaskSourceByExternalRef: async (
    repoId: string,
    provider: string,
    externalRef: string,
  ): Promise<TaskSource | null> =>
    (await db
      .selectFrom("task_sources")
      .selectAll()
      .where("repo_id", "=", repoId)
      .where("provider", "=", provider)
      .where("external_ref", "=", externalRef)
      .executeTakeFirst()) ?? null,

  getTaskSourceByTaskId: async (taskId: string): Promise<TaskSource | null> =>
    (await db
      .selectFrom("task_sources")
      .selectAll()
      .where("task_id", "=", taskId)
      .executeTakeFirst()) ?? null,

  listTaskSourcesByRepo: async (repoId: string, providers?: string[]): Promise<TaskSource[]> => {
    let query = db.selectFrom("task_sources").selectAll().where("repo_id", "=", repoId);
    if (providers && providers.length > 0) {
      query = query.where("provider", "in", providers);
    }
    return query.orderBy("provider", "asc").orderBy("external_ref", "asc").execute();
  },

  replaceTaskDependencies: async (input: ReplaceTaskDependenciesInput): Promise<void> => {
    const dependencyRows = buildDependencyRows(input.taskId, input.dependsOnTaskIds, input.source);

    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("task_dependencies")
        .where("task_id", "=", input.taskId)
        .where("source", "=", input.source)
        .execute();

      if (dependencyRows.length === 0) {
        return;
      }

      await trx
        .insertInto("task_dependencies")
        .values(dependencyRows)
        .onConflict((oc) => oc.columns(["task_id", "depends_on_task_id", "source"]).doNothing())
        .execute();
    });
  },

  replaceTaskDependencyEdges: async (input: ReplaceTaskDependencyEdgesInput): Promise<void> => {
    const dependencyRows = buildDependencyEdgeRows(input.taskId, input.dependencies);

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom("task_dependencies").where("task_id", "=", input.taskId).execute();

      if (dependencyRows.length === 0) {
        return;
      }

      await trx
        .insertInto("task_dependencies")
        .values(dependencyRows)
        .onConflict((oc) => oc.columns(["task_id", "depends_on_task_id", "source"]).doNothing())
        .execute();
    });
  },

  listTaskDependencies: async (taskId: string): Promise<TaskDependency[]> =>
    db
      .selectFrom("task_dependencies")
      .selectAll()
      .where("task_id", "=", taskId)
      .orderBy("depends_on_task_id", "asc")
      .orderBy("source", "asc")
      .execute(),
});

const buildDependencyRows = (taskId: string, dependsOnTaskIds: string[], source: string) =>
  uniqueDependencyIds(taskId, dependsOnTaskIds).map((dependsOnTaskId) => ({
    task_id: taskId,
    depends_on_task_id: dependsOnTaskId,
    source,
  }));

const buildDependencyEdgeRows = (
  taskId: string,
  dependencies: ReplaceTaskDependencyEdgesInput["dependencies"],
) => {
  const rowsByDependencyKey = new Map<
    string,
    { task_id: string; depends_on_task_id: string; source: string }
  >();

  for (const dependency of dependencies) {
    if (dependency.dependsOnTaskId === taskId) {
      throw new Error("Task cannot depend on itself");
    }

    const dependencyKey = `${dependency.source}:${dependency.dependsOnTaskId}`;
    if (!rowsByDependencyKey.has(dependencyKey)) {
      rowsByDependencyKey.set(dependencyKey, {
        task_id: taskId,
        depends_on_task_id: dependency.dependsOnTaskId,
        source: dependency.source,
      });
    }
  }

  return [...rowsByDependencyKey.values()];
};

const uniqueDependencyIds = (taskId: string, dependsOnTaskIds: string[]): string[] => {
  const uniqueIds = [...new Set(dependsOnTaskIds)];
  if (uniqueIds.includes(taskId)) {
    throw new Error("Task cannot depend on itself");
  }

  return uniqueIds;
};
