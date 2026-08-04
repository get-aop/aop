import { existsSync } from "node:fs";
import { generateTypeId, getLogger, type Logger } from "@aop/infra";
import type { NewTask, Repo, Task } from "../../db/schema.ts";
import {
  type ExternalIssueStore,
  getExternalIssueDependencySource,
} from "../../integrations/external-issues/store.ts";
import type { RepoRepository } from "../../repo/repository.ts";
import type { SettingsRepository } from "../../settings/repository.ts";
import { SettingKey } from "../../settings/types.ts";
import type { TaskRepository } from "../../task/repository.ts";
import {
  listTaskIdsOnDisk,
  resolveTaskFilePath,
  taskDocsExistOnDisk,
  toLegacyTaskChangePath,
} from "../../task-docs/paths.ts";
import { parseTaskDoc } from "../../task-docs/task.ts";
import type { TaskDependencySourceMetadata } from "../../task-docs/types.ts";

const logger = getLogger("reconcile");

export interface ReconcileResult {
  created: number;
  removed: number;
}

export interface ReconcileDeps {
  repoRepository: RepoRepository;
  taskRepository: TaskRepository;
  externalIssueStore: ExternalIssueStore;
  settingsRepository?: SettingsRepository;
}

export const reconcileRepo = async (repo: Repo, deps: ReconcileDeps): Promise<ReconcileResult> => {
  const startTime = performance.now();
  const log = logger.with({ repoId: repo.id, repoPath: repo.path });
  const includeLegacyRepoTasks =
    (await deps.settingsRepository?.get(SettingKey.DISCOVER_LEGACY_REPO_TASKS)) === "true";
  const tasksOnDisk = listTaskIdsOnDisk(repo.id, repo.path, { includeLegacyRepoTasks });

  const allTasks = await deps.taskRepository.list({ repo_id: repo.id });
  const activeTasks = allTasks.filter((t) => t.status !== "REMOVED");

  const created = await createMissingTasks(
    repo.id,
    tasksOnDisk,
    allTasks,
    deps.taskRepository,
    log,
  );
  const removed = await removeOrphanedTasks(repo, activeTasks, deps, log);
  await rebuildExternalIssueMirror(repo, deps.taskRepository, deps.externalIssueStore);

  const durationMs = Math.round(performance.now() - startTime);
  log.debug("Repo reconciliation complete in {durationMs}ms", { durationMs, created, removed });

  return { created, removed };
};

export const reconcileAllRepos = async (deps: ReconcileDeps): Promise<ReconcileResult> => {
  const startTime = performance.now();
  const repos = await deps.repoRepository.getAll();
  const result: ReconcileResult = { created: 0, removed: 0 };

  for (const repo of repos) {
    const repoResult = await reconcileRepo(repo, deps);
    result.created += repoResult.created;
    result.removed += repoResult.removed;
  }

  const durationMs = Math.round(performance.now() - startTime);
  logger.info(
    "Reconciliation complete in {durationMs}ms: {repoCount} repos, {created} created, {removed} removed",
    {
      durationMs,
      repoCount: repos.length,
      created: result.created,
      removed: result.removed,
    },
  );
  return result;
};

const createMissingTasks = async (
  repoId: string,
  tasksOnDisk: string[],
  allTasks: Task[],
  taskStore: TaskRepository,
  log: Logger,
): Promise<number> => {
  const knownTaskPaths = new Set(allTasks.map((t) => t.change_path));

  let created = 0;
  for (const taskName of tasksOnDisk) {
    const relativeChangePath = toLegacyTaskChangePath(taskName);
    if (knownTaskPaths.has(relativeChangePath)) continue;

    const task = await createDraftTask(repoId, relativeChangePath, taskStore);
    if (task) {
      created++;
      log.info("Created task for task folder: {taskName}", { taskName });
    }
  }

  return created;
};

const removeOrphanedTasks = async (
  repo: Repo,
  activeTasks: Task[],
  deps: ReconcileDeps,
  log: Logger,
): Promise<number> => {
  let removed = 0;
  for (const task of activeTasks) {
    if (taskDocsExistOnDisk(repo.id, repo.path, task.change_path)) continue;

    const wasRemoved = await deps.taskRepository.markRemoved(task.id);
    if (wasRemoved) {
      removed++;
      log.info("Marked task as removed: {taskId}", {
        taskId: task.id,
        changePath: task.change_path,
      });
    }
  }

  return removed;
};

const createDraftTask = async (
  repoId: string,
  changePath: string,
  taskStore: TaskRepository,
): Promise<Task | null> => {
  const newTask: NewTask = {
    id: generateTypeId("task"),
    repo_id: repoId,
    change_path: changePath,
    status: "DRAFT",
    worktree_path: null,
    ready_at: null,
  };

  return taskStore.createIdempotentRecordOnly(newTask);
};

const rebuildExternalIssueMirror = async (
  repo: Repo,
  taskRepository: TaskRepository,
  externalIssueStore: ExternalIssueStore,
): Promise<void> => {
  await taskRepository.refresh();
  const tasks = await taskRepository.list({ repo_id: repo.id, excludeRemoved: true });
  const taskIdsBySource = new Map<string, string>();
  const docsWithSource: Array<{
    taskId: string;
    provider: string;
    externalId: string;
    externalRef: string;
    externalUrl: string;
    title: string;
    dependencySources: TaskDependencySourceMetadata[];
  }> = [];

  for (const task of tasks) {
    const taskFilePath = resolveTaskFilePath(repo.id, repo.path, task.change_path);
    if (!existsSync(taskFilePath)) {
      continue;
    }

    const doc = await parseTaskDoc(taskFilePath);
    if (!doc.source) {
      continue;
    }

    taskIdsBySource.set(getSourceKey(doc.source.provider, doc.source.id), task.id);
    docsWithSource.push({
      taskId: task.id,
      provider: doc.source.provider,
      externalId: doc.source.id,
      externalRef: doc.source.ref,
      externalUrl: doc.source.url,
      title: doc.title,
      dependencySources: doc.dependencySources,
    });
  }

  for (const doc of docsWithSource) {
    await externalIssueStore.upsertTaskSource({
      taskId: doc.taskId,
      repoId: repo.id,
      provider: doc.provider,
      externalId: doc.externalId,
      externalRef: doc.externalRef,
      externalUrl: doc.externalUrl,
      titleSnapshot: doc.title,
    });
  }

  for (const doc of docsWithSource) {
    await externalIssueStore.replaceTaskDependencyEdges({
      taskId: doc.taskId,
      dependencies: doc.dependencySources.flatMap((source) => {
        const dependsOnTaskId = taskIdsBySource.get(getSourceKey(source.provider, source.id));
        if (!dependsOnTaskId) {
          return [];
        }

        return [
          {
            source: getExternalIssueDependencySource(source.provider),
            dependsOnTaskId,
          },
        ];
      }),
    });
  }
};

const getSourceKey = (provider: string, id: string): string => `${provider}:${id}`;
