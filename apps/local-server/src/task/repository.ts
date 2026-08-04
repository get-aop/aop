import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import { type Kysely, sql } from "kysely";
import type { Database, NewTask, Task, TaskUpdate } from "../db/schema.ts";
import type { TaskEventEmitter } from "../events/task-events.ts";
import { createRepoRepository } from "../repo/repository.ts";
import { type TaskAssignmentProjection, toSSETask } from "../status/handlers.ts";
import { createTaskAssignmentRepository } from "../task-assignment/repository.ts";
import {
  getCanonicalTaskDir,
  listTaskIdsOnDisk,
  resolveTaskDir,
  resolveTaskFilePath,
  toLegacyTaskChangePath,
  toTaskId,
} from "../task-docs/paths.ts";
import { parseTaskDoc, updateTaskDocStatus, writeTaskDoc } from "../task-docs/task.ts";
import type { TaskDoc, TaskDocFrontmatter } from "../task-docs/types.ts";
import type { TaskStatus as TaskStatusType } from "./types.ts";

export interface ListFilters {
  status?: TaskStatusType;
  repo_id?: string;
  orderByReadyAt?: "asc" | "desc";
  excludeRemoved?: boolean;
}

export interface CreatedTaskFilters {
  repoId: string;
  originChatSessionId: string | null;
  createdAtOrAfter: string;
}

export interface TaskMetrics {
  total: number;
  byStatus: Record<TaskStatusType, number>;
  successRate: number;
  avgDurationMs: number;
  avgFailedDurationMs: number;
}

export interface ConcurrencyLimits {
  globalMax: number;
  getRepoMax: (repoId: string) => Promise<number>;
}

export type DependencyState = "ready" | "waiting" | "blocked";

export interface TaskDependencyState {
  dependencyState: DependencyState;
  blockedByTaskIds: string[];
  blockedByRefs: string[];
}

export interface TaskRepository {
  refresh: () => Promise<void>;
  create: (task: NewTask) => Promise<Task>;
  createIdempotent: (task: NewTask) => Promise<Task | null>;
  createIdempotentRecordOnly: (task: NewTask) => Promise<Task | null>;
  get: (id: string) => Promise<Task | null>;
  getByChangePath: (repoId: string, changePath: string) => Promise<Task | null>;
  update: (id: string, updates: TaskUpdate) => Promise<Task | null>;
  markRemoved: (id: string) => Promise<boolean>;
  /** Hard-delete every task row for a repo (repo unregister purge). */
  deleteByRepoId: (repoId: string) => Promise<void>;
  list: (filters?: ListFilters) => Promise<Task[]>;
  findCreatedSince: (filters: CreatedTaskFilters) => Promise<Task[]>;
  countWorking: (repoId?: string) => Promise<number>;
  getDependencyState: (taskId: string) => Promise<TaskDependencyState>;
  getNextExecutable: (limits: ConcurrencyLimits) => Promise<Task | null>;
  getNextResumable: (limits: ConcurrencyLimits) => Promise<Task | null>;
  resetStaleWorkingTasks: () => Promise<number>;
  getMetrics: (repoId?: string) => Promise<TaskMetrics>;
}

export interface TaskRepositoryOptions {
  eventEmitter?: TaskEventEmitter;
}

interface DependencyRow {
  dependsOnTaskId: string;
  externalRef: string | null;
}

interface RuntimeEligibility {
  runnable: boolean;
  assignedAgentId: string | null;
}

const TASK_DIR = aopPaths.relativeTaskDocs();
const TASK_SYNC_FIELDS: Array<keyof Task> = [
  "repo_id",
  "change_path",
  "branch_name",
  "status",
  "worktree_path",
  "ready_at",
  "preferred_workflow",
  "base_branch",
  "preferred_provider",
  "retry_from_step",
  "resume_input",
  "archived_at",
  "handoff_pending_approval",
  "handoff_requires_approval_override",
  "created_at",
  "updated_at",
];

const taskIdFor = (repoId: string, changePath: string): string =>
  `task_${createHash("sha1").update(`${repoId}:${changePath}`).digest("hex").slice(0, 12)}`;

const normalizeTaskPath = (changePath: string): string => {
  if (changePath === TASK_DIR || changePath.startsWith(`${TASK_DIR}/`)) {
    return changePath;
  }

  return join(TASK_DIR, basename(changePath));
};

const buildTaskBody = (title: string): string =>
  [
    "",
    "## Description",
    title,
    "",
    "## Requirements",
    "",
    "## Acceptance Criteria",
    "- [ ] Define acceptance criteria",
    "",
  ].join("\n");

const compareNullableDate = (left: string | null, right: string | null): number => {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
};

const hasTaskUpdateField = (updates: TaskUpdate, key: keyof TaskUpdate): boolean =>
  Object.hasOwn(updates, key);

const getTaskUpdateValue = <T>(updates: TaskUpdate, key: keyof TaskUpdate, current: T): T => {
  if (!hasTaskUpdateField(updates, key)) {
    return current;
  }

  return (updates[key] ?? null) as T;
};

const matchesFilters = (task: Task, filters?: ListFilters): boolean => {
  if (filters?.status && task.status !== filters.status) return false;
  if (filters?.excludeRemoved && task.status === TaskStatus.REMOVED) return false;
  if (filters?.repo_id && task.repo_id !== filters.repo_id) return false;
  return true;
};

const buildTaskFrontmatter = (
  task: NewTask,
  title: string,
  changePath: string,
): TaskDocFrontmatter => ({
  id: task.id,
  title,
  status: task.status ?? TaskStatus.DRAFT,
  created: task.created_at ?? new Date().toISOString(),
  changePath,
  branch: undefined,
});

const nullableString = (value: string | null | undefined): string | null => value ?? null;

const nullableBoolean = (value: boolean | null | undefined): boolean | null => value ?? null;

const buildPersistedTask = (task: NewTask, changePath: string): Task => {
  const now = new Date().toISOString();
  return {
    id: task.id,
    repo_id: task.repo_id,
    change_path: changePath,
    branch_name: nullableString(task.branch_name),
    worktree_path: nullableString(task.worktree_path),
    status: task.status ?? TaskStatus.DRAFT,
    ready_at: nullableString(task.ready_at),
    preferred_workflow: nullableString(task.preferred_workflow),
    base_branch: nullableString(task.base_branch),
    preferred_provider: nullableString(task.preferred_provider),
    retry_from_step: nullableString(task.retry_from_step),
    resume_input: nullableString(task.resume_input),
    archived_at: nullableString(task.archived_at),
    handoff_pending_approval: task.handoff_pending_approval ?? false,
    handoff_requires_approval_override: nullableBoolean(task.handoff_requires_approval_override),
    origin_chat_session_id: nullableString(task.origin_chat_session_id),
    created_at: task.created_at ?? now,
    updated_at: task.updated_at ?? now,
  };
};

const EMPTY_DEPENDENCY_STATE: TaskDependencyState = {
  dependencyState: "ready",
  blockedByTaskIds: [],
  blockedByRefs: [],
};

const summarizeDependencyRows = (
  dependencyRows: DependencyRow[],
  tasksById: Map<string, Task>,
): TaskDependencyState => {
  const blockedByTaskIds = new Set<string>();
  const blockedByRefs = new Set<string>();
  const waitingTaskIds = new Set<string>();
  const waitingRefs = new Set<string>();

  for (const dependency of dependencyRows) {
    const task = tasksById.get(dependency.dependsOnTaskId);
    if (isTerminalDependency(task)) {
      blockedByTaskIds.add(dependency.dependsOnTaskId);
      addDependencyRef(blockedByRefs, dependency.externalRef);
      continue;
    }

    if (!task) {
      continue;
    }

    if (task.status !== TaskStatus.DONE || task.worktree_path !== null) {
      waitingTaskIds.add(dependency.dependsOnTaskId);
      addDependencyRef(waitingRefs, dependency.externalRef);
    }
  }

  if (blockedByTaskIds.size > 0) {
    return {
      dependencyState: "blocked",
      blockedByTaskIds: [...blockedByTaskIds],
      blockedByRefs: [...blockedByRefs],
    };
  }

  if (waitingTaskIds.size > 0) {
    return {
      dependencyState: "waiting",
      blockedByTaskIds: [...waitingTaskIds],
      blockedByRefs: [...waitingRefs],
    };
  }

  return EMPTY_DEPENDENCY_STATE;
};

const isTerminalDependency = (task: Task | undefined): boolean =>
  !task || task.status === TaskStatus.BLOCKED || task.status === TaskStatus.REMOVED;

const addDependencyRef = (refs: Set<string>, externalRef: string | null): void => {
  if (externalRef) {
    refs.add(externalRef);
  }
};

const canRunTask = async (
  task: Task,
  desiredStatus: TaskStatusType,
  workingByRepo: Map<string, number>,
  limits: ConcurrencyLimits,
  isTaskExecutable: (task: Task) => Promise<boolean>,
): Promise<boolean> => {
  const hasCapacity = await limits.getRepoMax(task.repo_id).then((repoMax) => {
    const repoWorking = workingByRepo.get(task.repo_id) ?? 0;
    return repoWorking < repoMax;
  });
  if (!hasCapacity) {
    return false;
  }

  if (desiredStatus !== TaskStatus.READY) {
    return true;
  }

  return isTaskExecutable(task);
};

const isRuntimeAuthoritativeTask = (task: Pick<Task, "status" | "worktree_path"> | null): boolean =>
  task !== null &&
  (task.worktree_path !== null ||
    task.status === TaskStatus.WORKING ||
    task.status === TaskStatus.RESUMING ||
    task.status === TaskStatus.PAUSED);

const hasTaskChanged = (persisted: Task | null, nextTask: Task): boolean => {
  if (!persisted) return true;
  return TASK_SYNC_FIELDS.some((field) => persisted[field] !== nextTask[field]);
};

const readPersistedField = <K extends keyof Task>(
  persisted: Task | null,
  field: K,
  fallback: Task[K],
): Task[K] => persisted?.[field] ?? fallback;

const normalizeTaskRecord = (task: Task): Task => ({
  ...task,
  handoff_pending_approval: Boolean(task.handoff_pending_approval),
  handoff_requires_approval_override:
    task.handoff_requires_approval_override === null
      ? null
      : Boolean(task.handoff_requires_approval_override),
});

const normalizeNullableTask = (task: Task | null): Task | null =>
  task ? normalizeTaskRecord(task) : null;

const canKeepArchivedAt = (status: Task["status"]): boolean =>
  status === TaskStatus.DONE || status === TaskStatus.REMOVED;

const resolveMappedStatus = (
  persisted: Task | null,
  doc: TaskDoc,
  hasRuntimeState: boolean,
): Task["status"] => {
  if (!hasRuntimeState) return doc.status;
  return readPersistedField(persisted, "status", doc.status);
};

const resolveMappedUpdatedAt = (
  persisted: Task | null,
  doc: TaskDoc,
  hasRuntimeState: boolean,
): string => {
  if (!hasRuntimeState) return doc.updatedAt;
  return readPersistedField(persisted, "updated_at", doc.updatedAt);
};

const buildMappedTask = (
  repoId: string,
  normalizedChangePath: string,
  doc: TaskDoc,
  persisted: Task | null,
): Task => {
  const hasRuntimeState = isRuntimeAuthoritativeTask(persisted);
  const status = resolveMappedStatus(persisted, doc, hasRuntimeState);
  return {
    id: doc.id ?? taskIdFor(repoId, normalizedChangePath),
    repo_id: repoId,
    change_path: doc.changePath ?? normalizedChangePath,
    branch_name: readPersistedField(persisted, "branch_name", null),
    worktree_path: readPersistedField(persisted, "worktree_path", null),
    status,
    ready_at: readPersistedField(persisted, "ready_at", null),
    preferred_workflow: readPersistedField(persisted, "preferred_workflow", null),
    base_branch: readPersistedField(persisted, "base_branch", doc.branch),
    preferred_provider: readPersistedField(persisted, "preferred_provider", null),
    retry_from_step: readPersistedField(persisted, "retry_from_step", null),
    resume_input: readPersistedField(persisted, "resume_input", null),
    archived_at: canKeepArchivedAt(status)
      ? readPersistedField(persisted, "archived_at", null)
      : null,
    handoff_pending_approval: readPersistedField(persisted, "handoff_pending_approval", false),
    handoff_requires_approval_override: readPersistedField(
      persisted,
      "handoff_requires_approval_override",
      null,
    ),
    origin_chat_session_id: readPersistedField(persisted, "origin_chat_session_id", null),
    created_at: readPersistedField(persisted, "created_at", doc.createdAt),
    updated_at: resolveMappedUpdatedAt(persisted, doc, hasRuntimeState),
  };
};

export const createTaskRepository = (
  db: Kysely<Database>,
  options: TaskRepositoryOptions = {},
): TaskRepository => {
  const { eventEmitter } = options;
  const repoRepository = createRepoRepository(db);
  const taskAssignmentRepository = createTaskAssignmentRepository(db);
  const cache = new Map<string, Task>();

  const getPersistedTask = async (id: string): Promise<Task | null> =>
    normalizeNullableTask(
      (await db.selectFrom("tasks").selectAll().where("id", "=", id).executeTakeFirst()) ?? null,
    );

  const upsertTask = async (task: Task): Promise<void> => {
    await db
      .insertInto("tasks")
      .values(task)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          repo_id: task.repo_id,
          change_path: task.change_path,
          branch_name: task.branch_name,
          worktree_path: task.worktree_path,
          status: task.status,
          ready_at: task.ready_at,
          preferred_workflow: task.preferred_workflow,
          base_branch: task.base_branch,
          preferred_provider: task.preferred_provider,
          retry_from_step: task.retry_from_step,
          resume_input: task.resume_input,
          archived_at: task.archived_at,
          handoff_pending_approval: task.handoff_pending_approval,
          handoff_requires_approval_override: task.handoff_requires_approval_override,
          // Preserve an existing origin session link unless the writer sets a new one.
          origin_chat_session_id: sql`COALESCE(${task.origin_chat_session_id}, tasks.origin_chat_session_id)`,
          created_at: task.created_at,
          updated_at: task.updated_at,
        }),
      )
      .execute();
  };

  const mapTaskFromDisk = async (
    repoId: string,
    repoPath: string,
    taskIdOrChangePath: string,
  ): Promise<Task> => {
    const normalizedChangePath = toLegacyTaskChangePath(taskIdOrChangePath);
    const taskFilePath = resolveTaskFilePath(repoId, repoPath, taskIdOrChangePath);
    const doc = await parseTaskDoc(taskFilePath);
    const persisted = await getPersistedTask(doc.id ?? taskIdFor(repoId, normalizedChangePath));
    const nextTask = buildMappedTask(repoId, normalizedChangePath, doc, persisted);

    if (hasTaskChanged(persisted, nextTask)) {
      await upsertTask(nextTask);
    }

    return nextTask;
  };

  const emitCreated = (task: Task, assignment?: TaskAssignmentProjection | null): void => {
    eventEmitter?.emit({
      type: "task-created",
      task: toSSETask(task, null, undefined, undefined, undefined, assignment),
    });
  };

  const emitStatusChanged = (
    task: Task,
    previousStatus: TaskStatusType,
    assignment?: TaskAssignmentProjection | null,
  ): void => {
    if (task.status === previousStatus) return;
    eventEmitter?.emit({
      type: "task-status-changed",
      taskId: task.id,
      previousStatus,
      newStatus: task.status as TaskStatusType,
      task: toSSETask(task, null, undefined, undefined, undefined, assignment),
    });
    // Fire-and-forget origin-session note for Done/Blocked transitions.
    void import("./origin-chat-session.ts")
      .then(({ notifyOriginChatOfTaskStatus }) =>
        notifyOriginChatOfTaskStatus(db, task.id, task.status as TaskStatusType, previousStatus),
      )
      .catch(() => undefined);
  };

  const emitUpdated = (task: Task): void => {
    eventEmitter?.emit({ type: "task-updated", taskId: task.id, task: toSSETask(task) });
  };

  const emitRemoved = (task: Task): void => {
    eventEmitter?.emit({ type: "task-removed", taskId: task.id, task: toSSETask(task) });
  };

  const scanRepoTasks = async (repoId: string, repoPath: string): Promise<Task[]> => {
    const tasks: Task[] = [];
    for (const taskId of listTaskIdsOnDisk(repoId, repoPath)) {
      tasks.push(await mapTaskFromDisk(repoId, repoPath, taskId));
    }
    return tasks;
  };

  const buildTaskSnapshot = async (): Promise<Map<string, Task>> => {
    const repos = await repoRepository.getAll();
    const next = new Map<string, Task>();

    await addRepoTasksToSnapshot(next, repos);
    await addPersistedTasksToSnapshot(next, new Set(repos.map((repo) => repo.id)));

    return next;
  };

  const addRepoTasksToSnapshot = async (
    next: Map<string, Task>,
    repos: Array<{ id: string; path: string }>,
  ): Promise<void> => {
    for (const repo of repos) {
      const tasks = await scanRepoTasks(repo.id, repo.path);
      for (const task of tasks) {
        next.set(task.id, task);
      }
    }
  };

  const addPersistedTasksToSnapshot = async (
    next: Map<string, Task>,
    repoIds: Set<string>,
  ): Promise<void> => {
    const persistedTasks = (await db.selectFrom("tasks").selectAll().execute()).map(
      normalizeTaskRecord,
    );
    for (const task of persistedTasks) {
      if (repoIds.has(task.repo_id) && !next.has(task.id)) {
        next.set(task.id, task);
      }
    }
  };

  const emitSnapshotTask = (
    taskId: string,
    task: Task,
    assignments: Map<string, TaskAssignmentProjection>,
  ): void => {
    const previous = cache.get(taskId);
    if (!previous) {
      emitCreated(task, assignments.get(taskId));
      return;
    }

    if (previous.status !== task.status) {
      emitStatusChanged(task, previous.status as TaskStatusType, assignments.get(taskId));
    } else if (previous.archived_at !== task.archived_at) {
      emitUpdated(task);
    }
  };

  const emitRemovedSnapshotTasks = (next: Map<string, Task>): void => {
    for (const [taskId, previous] of cache.entries()) {
      if (next.has(taskId)) continue;
      emitRemoved(previous);
    }
  };

  const changedSnapshotTaskIds = (next: Map<string, Task>): string[] => {
    const taskIds: string[] = [];
    for (const [taskId, task] of next.entries()) {
      const previous = cache.get(taskId);
      if (!previous || previous.status !== task.status) {
        taskIds.push(taskId);
      }
    }
    return taskIds;
  };

  const emitSnapshotChanges = async (next: Map<string, Task>): Promise<void> => {
    const assignments = await taskAssignmentRepository.getCurrentWithAgentNameByTaskIds(
      changedSnapshotTaskIds(next),
    );

    for (const [taskId, task] of next.entries()) {
      emitSnapshotTask(taskId, task, assignments);
    }

    emitRemovedSnapshotTasks(next);
  };

  const replaceCache = (next: Map<string, Task>): void => {
    cache.clear();
    for (const [taskId, task] of next.entries()) {
      cache.set(taskId, task);
    }
  };

  const refreshCache = async (): Promise<void> => {
    const next = await buildTaskSnapshot();
    await emitSnapshotChanges(next);
    replaceCache(next);
  };

  const findTaskFolder = async (repoId: string, taskId: string): Promise<string | null> => {
    const repo = await repoRepository.getById(repoId);
    if (!repo) return null;
    const task = cache.get(taskId);
    if (!task) return null;
    return resolveTaskDir(repoId, repo.path, task.change_path);
  };

  const sortTasks = (tasks: Task[], orderBy: "asc" | "desc" | undefined): Task[] => {
    if (!orderBy) return tasks;

    return [...tasks].sort((left, right) => {
      const result = compareNullableDate(left.ready_at, right.ready_at);
      return orderBy === "asc" ? result : result * -1;
    });
  };

  const getAllTasks = async (): Promise<Task[]> => {
    await refreshCache();
    return [...cache.values()];
  };

  const filterTasks = async (filters?: ListFilters): Promise<Task[]> => {
    const tasks = await getAllTasks();
    const filtered = tasks.filter((task) => matchesFilters(task, filters));

    return sortTasks(filtered, filters?.orderByReadyAt);
  };

  const findCreatedSince = async (filters: CreatedTaskFilters): Promise<Task[]> => {
    let query = db
      .selectFrom("tasks")
      .selectAll()
      .where("repo_id", "=", filters.repoId)
      .where("created_at", ">=", filters.createdAtOrAfter);
    query = filters.originChatSessionId
      ? query.where("origin_chat_session_id", "=", filters.originChatSessionId)
      : query.where("origin_chat_session_id", "is", null);
    return (await query.orderBy("created_at", "asc").orderBy("id", "asc").execute()).map(
      normalizeTaskRecord,
    );
  };

  const getWorkingCounts = async (): Promise<{
    globalWorking: number;
    workingByRepo: Map<string, number>;
  }> => {
    const workingByRepo = new Map<string, number>();
    const workingTasks = await filterTasks({ status: TaskStatus.WORKING });

    for (const task of workingTasks) {
      workingByRepo.set(task.repo_id, (workingByRepo.get(task.repo_id) ?? 0) + 1);
    }

    return {
      globalWorking: workingTasks.length,
      workingByRepo,
    };
  };

  const getDependencyRows = async (taskId: string): Promise<DependencyRow[]> =>
    db
      .selectFrom("task_dependencies as dependencies")
      .leftJoin("task_sources as sources", (join) =>
        join
          .onRef("sources.task_id", "=", "dependencies.depends_on_task_id")
          .on(sql<boolean>`dependencies.source = sources.provider || '_blocks'`),
      )
      .select([
        "dependencies.depends_on_task_id as dependsOnTaskId",
        "sources.external_ref as externalRef",
      ])
      .where("dependencies.task_id", "=", taskId)
      .orderBy("dependencies.depends_on_task_id", "asc")
      .orderBy("dependencies.source", "asc")
      .execute();

  const getDependencyState = async (taskId: string): Promise<TaskDependencyState> => {
    await refreshCache();
    const dependencyRows = await getDependencyRows(taskId);
    if (dependencyRows.length === 0) {
      return EMPTY_DEPENDENCY_STATE;
    }

    return summarizeDependencyRows(dependencyRows, cache);
  };

  const isTaskExecutable = async (task: Task): Promise<boolean> => {
    const dependencyState = await getDependencyState(task.id);
    return dependencyState.dependencyState === "ready";
  };

  const getCurrentAssignment = async (taskId: string) =>
    db
      .selectFrom("task_assignments")
      .select(["agent_id", "repo_id"])
      .where("task_id", "=", taskId)
      .where("is_current", "=", true)
      .executeTakeFirst();

  const isAssignedAgentActive = async (agentId: string): Promise<boolean> => {
    const agent = await db
      .selectFrom("agents")
      .select(["status"])
      .where("id", "=", agentId)
      .executeTakeFirst();

    return agent?.status === "active";
  };

  const hasRepoMembership = async (agentId: string, repoId: string): Promise<boolean> => {
    const membership = await db
      .selectFrom("agent_repo_memberships")
      .select("agent_id")
      .where("agent_id", "=", agentId)
      .where("repo_id", "=", repoId)
      .executeTakeFirst();

    return membership !== undefined;
  };

  const countAgentActiveTasks = async (agentId: string, exceptTaskId: string): Promise<number> => {
    const row = await db
      .selectFrom("task_assignments")
      .innerJoin("tasks", "tasks.id", "task_assignments.task_id")
      .select((eb) => eb.fn.count("tasks.id").as("count"))
      .where("task_assignments.agent_id", "=", agentId)
      .where("task_assignments.is_current", "=", true)
      .where("tasks.id", "!=", exceptTaskId)
      .where("tasks.status", "in", [TaskStatus.WORKING, TaskStatus.RESUMING])
      .executeTakeFirstOrThrow();

    return Number(row.count);
  };

  const getRuntimeEligibility = async (task: Task): Promise<RuntimeEligibility> => {
    const assignment = await getCurrentAssignment(task.id);
    if (!assignment) {
      return { runnable: true, assignedAgentId: null };
    }

    if (!(await isAssignedAgentActive(assignment.agent_id))) {
      return { runnable: false, assignedAgentId: assignment.agent_id };
    }

    if (!(await hasRepoMembership(assignment.agent_id, task.repo_id))) {
      return { runnable: false, assignedAgentId: assignment.agent_id };
    }

    if ((await countAgentActiveTasks(assignment.agent_id, task.id)) > 0) {
      return { runnable: false, assignedAgentId: assignment.agent_id };
    }

    return { runnable: true, assignedAgentId: assignment.agent_id };
  };

  const pickNextTask = async (
    limits: ConcurrencyLimits,
    desiredStatus: TaskStatusType,
    orderBy: "asc" | "desc",
  ): Promise<Task | null> => {
    const tasks = await filterTasks({
      status: desiredStatus,
      excludeRemoved: true,
      orderByReadyAt: orderBy,
    });

    const { globalWorking, workingByRepo } = await getWorkingCounts();

    if (globalWorking >= limits.globalMax) {
      return null;
    }

    for (const task of tasks) {
      const runtimeEligibility = await getRuntimeEligibility(task);
      if (!runtimeEligibility.runnable) {
        continue;
      }

      const readyToRun = await canRunTask(
        task,
        desiredStatus,
        workingByRepo,
        limits,
        isTaskExecutable,
      );
      if (readyToRun) return task;
    }

    return null;
  };

  const getTaskOrRefreshFallback = async (
    taskId: string,
    repoId: string,
    repoPath: string,
    changePath: string,
  ): Promise<Task> => {
    await refreshCache();
    return cache.get(taskId) ?? (await mapTaskFromDisk(repoId, repoPath, changePath));
  };

  const createTaskRecord = async (task: NewTask): Promise<Task> => {
    const repo = await repoRepository.getById(task.repo_id);
    if (!repo) {
      throw new Error(`Repo not found: ${task.repo_id}`);
    }
    const changePath = normalizeTaskPath(task.change_path);
    const taskId = taskIdFor(task.repo_id, changePath);
    const taskPathId = toTaskId(changePath);

    const taskDir = getCanonicalTaskDir(task.repo_id, taskPathId);
    mkdirSync(taskDir, { recursive: true });

    const title = basename(changePath);
    const frontmatter = buildTaskFrontmatter(task, title, changePath);

    await writeTaskDoc(join(taskDir, "task.md"), frontmatter, buildTaskBody(title));
    await upsertTask(buildPersistedTask(task, changePath));
    return getTaskOrRefreshFallback(taskId, task.repo_id, repo.path, taskPathId);
  };

  const createTaskRecordOnly = async (task: NewTask): Promise<Task> => {
    const persistedTask = buildPersistedTask(task, normalizeTaskPath(task.change_path));

    await upsertTask(persistedTask);
    await refreshCache();
    return cache.get(task.id) ?? persistedTask;
  };

  const syncTaskStatusToDisk = async (task: Task, status: TaskUpdate["status"]): Promise<void> => {
    if (!status) return;

    const taskDir = await findTaskFolder(task.repo_id, task.id);
    if (!taskDir) return;

    const taskDocPath = join(taskDir, "task.md");
    if (!existsSync(taskDocPath)) return;

    await updateTaskDocStatus(taskDocPath, status as TaskStatusType);
  };

  const updateTaskRecord = async (id: string, updates: TaskUpdate): Promise<Task | null> => {
    await refreshCache();
    const existing = cache.get(id);
    if (!existing) return null;

    const status = getTaskUpdateValue(updates, "status", existing.status);
    const archivedAt = getTaskUpdateValue(updates, "archived_at", existing.archived_at);
    const updated: Task = {
      ...existing,
      branch_name: getTaskUpdateValue(updates, "branch_name", existing.branch_name),
      worktree_path: getTaskUpdateValue(updates, "worktree_path", existing.worktree_path),
      status,
      ready_at: getTaskUpdateValue(updates, "ready_at", existing.ready_at),
      preferred_workflow: getTaskUpdateValue(
        updates,
        "preferred_workflow",
        existing.preferred_workflow,
      ),
      base_branch: getTaskUpdateValue(updates, "base_branch", existing.base_branch),
      preferred_provider: getTaskUpdateValue(
        updates,
        "preferred_provider",
        existing.preferred_provider,
      ),
      retry_from_step: getTaskUpdateValue(updates, "retry_from_step", existing.retry_from_step),
      resume_input: getTaskUpdateValue(updates, "resume_input", existing.resume_input),
      archived_at: canKeepArchivedAt(status) ? archivedAt : null,
      handoff_pending_approval: getTaskUpdateValue(
        updates,
        "handoff_pending_approval",
        existing.handoff_pending_approval,
      ),
      handoff_requires_approval_override: getTaskUpdateValue(
        updates,
        "handoff_requires_approval_override",
        existing.handoff_requires_approval_override,
      ),
      origin_chat_session_id: getTaskUpdateValue(
        updates,
        "origin_chat_session_id",
        existing.origin_chat_session_id,
      ),
      updated_at: new Date().toISOString(),
    };
    await upsertTask(updated);
    await syncTaskStatusToDisk(existing, updates.status);

    await refreshCache();
    return cache.get(id) ?? null;
  };

  const markRemoved = async (id: string): Promise<boolean> => {
    const task = await getTask(id);
    if (!task || task.status === TaskStatus.WORKING) return false;
    await updateTaskRecord(id, { status: TaskStatus.REMOVED });
    return true;
  };

  const getTask = async (id: string): Promise<Task | null> => {
    await refreshCache();
    return cache.get(id) ?? null;
  };

  return {
    refresh: refreshCache,

    create: createTaskRecord,

    createIdempotent: async (task: NewTask): Promise<Task | null> => {
      await refreshCache();
      const changePath = normalizeTaskPath(task.change_path);
      const existing = [...cache.values()].find(
        (entry) =>
          entry.repo_id === task.repo_id && normalizeTaskPath(entry.change_path) === changePath,
      );
      if (existing) return existing;
      return createTaskRecord({ ...task, change_path: changePath });
    },

    createIdempotentRecordOnly: async (task: NewTask): Promise<Task | null> => {
      await refreshCache();
      const changePath = normalizeTaskPath(task.change_path);
      const existing = [...cache.values()].find(
        (entry) =>
          entry.repo_id === task.repo_id && normalizeTaskPath(entry.change_path) === changePath,
      );
      if (existing) {
        if (task.origin_chat_session_id && !existing.origin_chat_session_id) {
          return updateTaskRecord(existing.id, {
            origin_chat_session_id: task.origin_chat_session_id,
          });
        }
        return existing;
      }
      return createTaskRecordOnly({ ...task, change_path: changePath });
    },

    get: getTask,

    getByChangePath: async (repoId: string, changePath: string): Promise<Task | null> => {
      await refreshCache();
      const normalizedChangePath = normalizeTaskPath(changePath);
      return (
        [...cache.values()].find(
          (task) =>
            task.repo_id === repoId && normalizeTaskPath(task.change_path) === normalizedChangePath,
        ) ?? null
      );
    },

    update: updateTaskRecord,

    markRemoved,

    deleteByRepoId: async (repoId: string): Promise<void> => {
      await db.deleteFrom("tasks").where("repo_id", "=", repoId).execute();
      await refreshCache();
    },

    list: filterTasks,

    findCreatedSince,

    countWorking: async (repoId?: string): Promise<number> => {
      const tasks = await filterTasks({ status: TaskStatus.WORKING, repo_id: repoId });
      return tasks.length;
    },

    getDependencyState,

    getNextExecutable: (limits: ConcurrencyLimits) => pickNextTask(limits, TaskStatus.READY, "asc"),

    getNextResumable: (limits: ConcurrencyLimits) =>
      pickNextTask(limits, TaskStatus.RESUMING, "desc"),

    resetStaleWorkingTasks: async (): Promise<number> => {
      const tasks = await filterTasks({ status: TaskStatus.WORKING });
      for (const task of tasks) {
        await updateTaskRecord(task.id, { status: TaskStatus.READY });
      }
      return tasks.length;
    },

    getMetrics: async (repoId?: string): Promise<TaskMetrics> => {
      const tasks = await filterTasks({ repo_id: repoId, excludeRemoved: true });
      const byStatus: Record<TaskStatusType, number> = {
        DRAFT: 0,
        READY: 0,
        RESUMING: 0,
        WORKING: 0,
        PAUSED: 0,
        BLOCKED: 0,
        DONE: 0,
        REMOVED: 0,
      };

      for (const task of tasks) {
        byStatus[task.status as TaskStatusType]++;
      }

      const successRate =
        byStatus.DONE + byStatus.BLOCKED > 0
          ? byStatus.DONE / (byStatus.DONE + byStatus.BLOCKED)
          : 0;

      return {
        total: tasks.length,
        byStatus,
        successRate,
        avgDurationMs: 0,
        avgFailedDurationMs: 0,
      };
    },
  };
};
