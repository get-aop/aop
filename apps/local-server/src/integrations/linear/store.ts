import type { Kysely } from "kysely";
import type { Database, TaskDependency, TaskSource } from "../../db/schema.ts";
import {
  createExternalIssueStore,
  type ExternalIssueStore,
  getExternalIssueDependencySource,
} from "../external-issues/store.ts";

const LINEAR_PROVIDER = "linear";
const LINEAR_BLOCKS_SOURCE = getExternalIssueDependencySource(LINEAR_PROVIDER);

export interface UpsertTaskSourceInput {
  taskId: string;
  repoId: string;
  externalId: string;
  externalRef: string;
  externalUrl: string;
  titleSnapshot: string;
}

export interface LinearStore {
  upsertTaskSource(input: UpsertTaskSourceInput): Promise<void>;
  getTaskSourceByExternalId(repoId: string, externalId: string): Promise<TaskSource | null>;
  getTaskSourceByExternalRef(repoId: string, externalRef: string): Promise<TaskSource | null>;
  replaceTaskDependencies(taskId: string, dependsOnTaskIds: string[]): Promise<void>;
  listTaskDependencies(taskId: string): Promise<TaskDependency[]>;
}

export const createLinearStore = (
  storeOrDb: ExternalIssueStore | Kysely<Database>,
): LinearStore => {
  const store = isExternalIssueStore(storeOrDb) ? storeOrDb : createExternalIssueStore(storeOrDb);

  return {
    upsertTaskSource: (input: UpsertTaskSourceInput): Promise<void> =>
      store.upsertTaskSource({
        ...input,
        provider: LINEAR_PROVIDER,
      }),

    getTaskSourceByExternalId: (repoId: string, externalId: string): Promise<TaskSource | null> =>
      store.getTaskSourceByExternalId(repoId, LINEAR_PROVIDER, externalId),

    getTaskSourceByExternalRef: (repoId: string, externalRef: string): Promise<TaskSource | null> =>
      store.getTaskSourceByExternalRef(repoId, LINEAR_PROVIDER, externalRef),

    replaceTaskDependencies: (taskId: string, dependsOnTaskIds: string[]): Promise<void> =>
      store.replaceTaskDependencies({
        taskId,
        source: LINEAR_BLOCKS_SOURCE,
        dependsOnTaskIds,
      }),

    listTaskDependencies: (taskId: string): Promise<TaskDependency[]> =>
      store.listTaskDependencies(taskId),
  };
};

const isExternalIssueStore = (
  value: ExternalIssueStore | Kysely<Database>,
): value is ExternalIssueStore => "upsertTaskSource" in value;
