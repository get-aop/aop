import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { Task, TaskSource } from "../../db/schema.ts";
import type { RepoRepository } from "../../repo/repository.ts";
import type { TaskRepository } from "../../task/repository.ts";
import { resolveTaskDir } from "../../task-docs/paths.ts";
import { toTaskSlug } from "../../task-docs/scaffold.ts";
import { parseTaskDoc, writeTaskDoc } from "../../task-docs/task.ts";
import type { TaskDocFrontmatter } from "../../task-docs/types.ts";
import { getPublishedTaskDir } from "./import-paths.ts";
import { type ExternalIssueStore, getExternalIssueDependencySource } from "./store.ts";

export interface ExternalIssueSummary {
  id: string;
  ref: string;
  title: string;
  url: string;
}

export interface ExternalResolvedIssue extends ExternalIssueSummary {
  blocks: ExternalIssueSummary[];
}

export interface ExternalIssueImportRecord {
  taskId: string;
  ref: string;
  changePath: string;
  requested: boolean;
  dependencyImported: boolean;
}

export interface ExternalIssueImportFailure {
  ref: string;
  error: string;
}

export interface ExternalIssueImportResult {
  imported: ExternalIssueImportRecord[];
  failures: ExternalIssueImportFailure[];
}

export interface ProviderIssueImportStore {
  upsertTaskSource(input: UpsertImportedTaskSourceInput): Promise<void>;
  getTaskSourceByExternalId(repoId: string, externalId: string): Promise<TaskSource | null>;
  replaceTaskDependencies(taskId: string, dependsOnTaskIds: string[]): Promise<void>;
}

export interface UpsertImportedTaskSourceInput {
  taskId: string;
  repoId: string;
  externalId: string;
  externalRef: string;
  externalUrl: string;
  titleSnapshot: string;
}

interface CreateExternalIssueImporterOptions<TIssue extends ExternalResolvedIssue> {
  provider: string;
  missingBlockersLabel: string;
  repoRepository: RepoRepository;
  taskRepository: TaskRepository;
  issueStore: ProviderIssueImportStore;
  resolveIssuesByRefs(refs: string[]): Promise<TIssue[]>;
  buildTaskBody(issue: TIssue): string;
  buildIssuesMarkdown(issue: TIssue): string;
  buildTaskTags(issue: TIssue): string[];
  mapPriority(issue: TIssue): string;
  assignTaskToAgent?(repoId: string, taskId: string, agentId: string): Promise<void>;
}

export const createProviderIssueImportStore = (
  store: ExternalIssueStore,
  provider: string,
): ProviderIssueImportStore => ({
  upsertTaskSource: (input: UpsertImportedTaskSourceInput): Promise<void> =>
    store.upsertTaskSource({
      ...input,
      provider,
    }),

  getTaskSourceByExternalId: (repoId: string, externalId: string): Promise<TaskSource | null> =>
    store.getTaskSourceByExternalId(repoId, provider, externalId),

  replaceTaskDependencies: (taskId: string, dependsOnTaskIds: string[]): Promise<void> =>
    store.replaceTaskDependencies({
      taskId,
      source: getExternalIssueDependencySource(provider),
      dependsOnTaskIds,
    }),
});

export const createExternalIssueImporter = <TIssue extends ExternalResolvedIssue>(
  options: CreateExternalIssueImporterOptions<TIssue>,
) => ({
  importIssues: async (params: {
    repoId: string;
    issues: TIssue[];
    agentId: string;
  }): Promise<ExternalIssueImportResult> => {
    const repo = await getRepoOrThrow(options.repoRepository, params.repoId);
    const requestedByRef = new Map(params.issues.map((issue) => [issue.ref, issue]));
    const { failures, importedByRef } = await resolveImportGraphs(params.issues, options);

    if (importedByRef.size === 0) {
      return { imported: [], failures };
    }

    const { importedRecords, taskIdsBySourceId } = await writeImportedTasks({
      repoId: params.repoId,
      repoPath: repo.path,
      importedByRef,
      requestedByRef,
      agentId: params.agentId,
      options,
    });

    await persistLinkage({
      repoId: params.repoId,
      importedByRef,
      importedRecords,
      issueStore: options.issueStore,
      taskIdsBySourceId,
    });

    return {
      imported: orderImportedRecords(importedRecords, params.issues, requestedByRef),
      failures,
    };
  },
});

const getRepoOrThrow = async (repoRepository: RepoRepository, repoId: string) => {
  const repo = await repoRepository.getById(repoId);
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`);
  }
  return repo;
};

const resolveImportGraphs = async <TIssue extends ExternalResolvedIssue>(
  issues: TIssue[],
  options: Pick<
    CreateExternalIssueImporterOptions<TIssue>,
    "resolveIssuesByRefs" | "missingBlockersLabel" | "provider"
  >,
): Promise<{
  failures: ExternalIssueImportFailure[];
  importedByRef: Map<string, TIssue>;
}> => {
  const importedByRef = new Map<string, TIssue>();
  const failures: ExternalIssueImportFailure[] = [];

  for (const issue of issues) {
    try {
      const graph = await collectIssueGraph(issue, options);
      for (const [ref, resolvedIssue] of graph) {
        importedByRef.set(ref, resolvedIssue);
      }
    } catch (error) {
      failures.push({
        ref: issue.ref,
        error:
          error instanceof Error ? error.message : `Failed to import ${options.provider} issue`,
      });
    }
  }

  return { failures, importedByRef };
};

const writeImportedTasks = async <TIssue extends ExternalResolvedIssue>(params: {
  repoId: string;
  repoPath: string;
  importedByRef: Map<string, TIssue>;
  requestedByRef: Map<string, TIssue>;
  agentId: string;
  options: CreateExternalIssueImporterOptions<TIssue>;
}): Promise<{
  importedRecords: Map<string, ExternalIssueImportRecord>;
  taskIdsBySourceId: Map<string, string>;
}> => {
  const importedRecords = new Map<string, ExternalIssueImportRecord>();
  const taskIdsBySourceId = new Map<string, string>();

  for (const issue of params.importedByRef.values()) {
    const requested = params.requestedByRef.has(issue.ref);
    const record = await writeImportedTask({
      repoId: params.repoId,
      repoPath: params.repoPath,
      issue,
      requested,
      agentId: params.agentId,
      options: params.options,
    });
    await writeImportedIssuesDoc({
      repoId: params.repoId,
      repoPath: params.repoPath,
      changePath: record.changePath,
      issue,
      options: params.options,
    });
    importedRecords.set(issue.ref, record);
    taskIdsBySourceId.set(issue.id, record.taskId);
  }

  await params.options.taskRepository.refresh();

  return { importedRecords, taskIdsBySourceId };
};

const persistLinkage = async <TIssue extends ExternalResolvedIssue>(params: {
  repoId: string;
  importedByRef: Map<string, TIssue>;
  importedRecords: Map<string, ExternalIssueImportRecord>;
  issueStore: ProviderIssueImportStore;
  taskIdsBySourceId: Map<string, string>;
}): Promise<void> => {
  for (const issue of params.importedByRef.values()) {
    const record = params.importedRecords.get(issue.ref);
    if (!record) {
      continue;
    }

    await params.issueStore.upsertTaskSource({
      taskId: record.taskId,
      repoId: params.repoId,
      externalId: issue.id,
      externalRef: issue.ref,
      externalUrl: issue.url,
      titleSnapshot: issue.title,
    });
    await params.issueStore.replaceTaskDependencies(
      record.taskId,
      issue.blocks
        .map((blocker) => params.taskIdsBySourceId.get(blocker.id))
        .filter((taskId): taskId is string => typeof taskId === "string"),
    );
  }
};

const orderImportedRecords = <TIssue extends ExternalResolvedIssue>(
  importedRecords: Map<string, ExternalIssueImportRecord>,
  requestedIssues: TIssue[],
  requestedByRef: Map<string, TIssue>,
): ExternalIssueImportRecord[] => {
  const orderedRefs = [
    ...requestedIssues.map((issue) => issue.ref),
    ...[...importedRecords.keys()]
      .filter((ref) => !requestedByRef.has(ref))
      .sort((left, right) => left.localeCompare(right)),
  ];

  return orderedRefs.flatMap((ref) => {
    const record = importedRecords.get(ref);
    return record ? [record] : [];
  });
};

const collectIssueGraph = async <TIssue extends ExternalResolvedIssue>(
  rootIssue: TIssue,
  options: Pick<
    CreateExternalIssueImporterOptions<TIssue>,
    "resolveIssuesByRefs" | "missingBlockersLabel"
  >,
): Promise<Map<string, TIssue>> => {
  const graph = new Map<string, TIssue>([[rootIssue.ref, rootIssue]]);

  while (true) {
    const missingRefs = [...graph.values()]
      .flatMap((issue) => issue.blocks.map((blocker) => blocker.ref))
      .filter((ref) => !graph.has(ref));

    if (missingRefs.length === 0) {
      return graph;
    }

    const uniqueRefs = [...new Set(missingRefs)];
    const resolvedIssues = await options.resolveIssuesByRefs(uniqueRefs);
    const resolvedByRef = new Map(resolvedIssues.map((issue) => [issue.ref, issue]));
    const unresolvedRefs = uniqueRefs.filter((ref) => !resolvedByRef.has(ref));

    if (unresolvedRefs.length > 0) {
      throw new Error(`Missing ${options.missingBlockersLabel}: ${unresolvedRefs.join(", ")}`);
    }

    for (const issue of resolvedIssues) {
      graph.set(issue.ref, issue);
    }
  }
};

const writeImportedTask = async <TIssue extends ExternalResolvedIssue>(params: {
  repoId: string;
  repoPath: string;
  issue: TIssue;
  requested: boolean;
  agentId: string;
  options: CreateExternalIssueImporterOptions<TIssue>;
}): Promise<ExternalIssueImportRecord> => {
  const existingSource = await params.options.issueStore.getTaskSourceByExternalId(
    params.repoId,
    params.issue.id,
  );
  const candidateTaskId =
    existingSource?.task_id ??
    buildExternalIssueTaskId(params.repoId, params.options.provider, params.issue.id);
  const existingTaskById = await params.options.taskRepository.get(candidateTaskId);
  const candidateChangePath =
    existingTaskById?.change_path ??
    join(aopPaths.relativeTaskDocs(), toTaskSlug(`${params.issue.ref} ${params.issue.title}`));
  const existingTaskByChangePath = existingTaskById
    ? null
    : await params.options.taskRepository.getByChangePath(params.repoId, candidateChangePath);
  const existingTask = existingTaskById ?? existingTaskByChangePath;
  const taskId = existingTask?.id ?? candidateTaskId;
  const changePath = existingTask?.change_path ?? candidateChangePath;
  const writeTargetDir = getPublishedTaskDir(params.repoId, params.repoPath, changePath);
  const taskFilePath = join(writeTargetDir, "task.md");
  const existingDoc = await readExistingTaskDoc(params.repoId, params.repoPath, changePath);

  await mkdir(writeTargetDir, { recursive: true });
  const persistedTask = await ensureTaskRecord(params.options.taskRepository, {
    taskId,
    repoId: params.repoId,
    changePath,
    existingTask,
  });
  const actualTaskId = persistedTask?.id ?? taskId;

  const frontmatter: TaskDocFrontmatter = {
    id: actualTaskId,
    title: params.issue.title,
    status: getImportedTaskStatus(existingTask?.status, existingDoc?.status),
    created: existingDoc?.createdAt ?? new Date().toISOString(),
    changePath,
    priority: params.options.mapPriority(params.issue),
    tags: params.options.buildTaskTags(params.issue),
    source: {
      provider: params.options.provider,
      id: params.issue.id,
      ref: params.issue.ref,
      url: params.issue.url,
    },
    dependencySources: params.issue.blocks.map((blocker) => ({
      provider: params.options.provider,
      id: blocker.id,
      ref: blocker.ref,
    })),
    dependencyImported: !params.requested,
  };

  await writeTaskDoc(taskFilePath, frontmatter, params.options.buildTaskBody(params.issue));
  await params.options.assignTaskToAgent?.(params.repoId, actualTaskId, params.agentId);

  return {
    taskId: actualTaskId,
    ref: params.issue.ref,
    changePath,
    requested: params.requested,
    dependencyImported: !params.requested,
  };
};

const writeImportedIssuesDoc = async <TIssue extends ExternalResolvedIssue>(params: {
  repoId: string;
  repoPath: string;
  changePath: string;
  issue: TIssue;
  options: Pick<CreateExternalIssueImporterOptions<TIssue>, "buildIssuesMarkdown">;
}): Promise<void> => {
  const writeTargetDir = getPublishedTaskDir(params.repoId, params.repoPath, params.changePath);
  await Bun.write(
    join(writeTargetDir, "issues.md"),
    params.options.buildIssuesMarkdown(params.issue),
  );
};

export const buildExternalIssueTaskId = (
  repoId: string,
  provider: string,
  externalId: string,
): string =>
  `task_${createHash("sha1").update(`${repoId}:${provider}:${externalId}`).digest("hex").slice(0, 12)}`;

const readExistingTaskDoc = async (repoId: string, repoPath: string, changePath: string) => {
  const preferredPaths = [resolveTaskDir(repoId, repoPath, changePath)];

  for (const taskDir of preferredPaths) {
    const taskFilePath = join(taskDir, "task.md");
    if (await Bun.file(taskFilePath).exists()) {
      return parseTaskDoc(taskFilePath);
    }
  }

  return null;
};

const ensureTaskRecord = async (
  taskRepository: TaskRepository,
  params: {
    taskId: string;
    repoId: string;
    changePath: string;
    existingTask: Task | null;
  },
): Promise<Task | null> => {
  if (params.existingTask && params.existingTask.status !== TaskStatus.REMOVED) {
    return params.existingTask;
  }

  if (params.existingTask?.status === TaskStatus.REMOVED) {
    return taskRepository.update(params.existingTask.id, {
      status: TaskStatus.DRAFT,
      ready_at: null,
      retry_from_step: null,
    });
  }

  return taskRepository.createIdempotentRecordOnly({
    id: params.taskId,
    repo_id: params.repoId,
    change_path: params.changePath,
    status: TaskStatus.DRAFT,
    worktree_path: null,
    ready_at: null,
  });
};

const getImportedTaskStatus = (
  existingTaskStatus: string | null | undefined,
  existingDocStatus: TaskDocFrontmatter["status"] | undefined,
): TaskDocFrontmatter["status"] => {
  if (existingTaskStatus === TaskStatus.REMOVED || existingDocStatus === TaskStatus.REMOVED) {
    return TaskStatus.DRAFT;
  }

  return existingDocStatus ?? existingTaskStatus ?? TaskStatus.DRAFT;
};
