import type { SSERepoWithTasks, SSEServerStatus, SSETask } from "@aop/common";
import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("cli", "status");

export interface StatusOptions {
  json?: boolean;
}

type Task = SSETask;
type RepoStatus = SSERepoWithTasks;
type StatusResponse = SSEServerStatus;
type ResolvedTaskResponse = { task: Record<string, unknown> };

const writeJson = (data: unknown): void => {
  const encoder = new TextEncoder();
  Bun.write(Bun.stdout, encoder.encode(`${JSON.stringify(data)}\n`));
};

export const statusCommand = async (
  taskId?: string,
  options: StatusOptions = {},
): Promise<void> => {
  if (taskId) {
    await showSingleTask(taskId, options);
  } else {
    await showFullStatus(options);
  }
};

const matchesIdentifier = (task: Task, repo: RepoStatus, identifier: string): boolean => {
  if (task.id === identifier || task.id.startsWith(identifier)) {
    return true;
  }
  if (task.changePath === identifier || task.changePath.endsWith(`/${identifier}`)) {
    return true;
  }
  const fullChangePath = `${repo.path}/${task.changePath}`;
  // Only match if identifier exactly equals fullChangePath or starts with repo.path
  if (identifier === fullChangePath) {
    return true;
  }
  // If identifier is an absolute path, it must belong to this repo
  if (identifier.startsWith("/") && identifier.startsWith(repo.path)) {
    return identifier === fullChangePath || identifier.endsWith(`/${task.changePath}`);
  }
  return false;
};

const showSingleTask = async (identifier: string, options: StatusOptions): Promise<void> => {
  if (options.json && (await writeResolvedTaskJson(identifier))) return;

  const status = await fetchStatusOrExit();
  const foundTask = findTask(status.repos, identifier);

  if (!foundTask) {
    return exitTaskNotFound(identifier, options);
  }

  if (options.json) {
    writeJson(foundTask);
    return;
  }

  printTaskDetails(foundTask);
};

const writeResolvedTaskJson = async (identifier: string): Promise<boolean> => {
  const resolved = await fetchServer<ResolvedTaskResponse>(
    `/api/tasks/resolve/${encodeURIComponent(identifier)}`,
  );

  if (!resolved.ok || !resolved.data.task) return false;

  writeJson(resolved.data.task);
  return true;
};

const fetchStatusOrExit = async (): Promise<StatusResponse> => {
  const result = await fetchServer<StatusResponse>("/api/status");

  if (result.ok) return result.data;

  logger.error("Error: Failed to fetch status from server");
  process.exit(1);
};

const findTask = (repos: RepoStatus[], identifier: string): Task | undefined => {
  for (const repo of repos) {
    const task = repo.tasks.find((candidate) => matchesIdentifier(candidate, repo, identifier));
    if (task) return task;
  }

  return undefined;
};

const exitTaskNotFound = (identifier: string, options: StatusOptions): never => {
  if (options.json) {
    writeJson({ error: "Task not found", identifier });
  } else {
    logger.error("Error: Task '{identifier}' not found", { identifier });
  }

  process.exit(1);
};

const showFullStatus = async (options: StatusOptions): Promise<void> => {
  const result = await fetchServer<StatusResponse>("/api/status");

  if (!result.ok) {
    logger.error("Error: Failed to fetch status from server");
    process.exit(1);
  }

  if (options.json) {
    writeJson(result.data);
  } else {
    printFullStatus(result.data);
  }
};

const printRepoStatus = (repo: RepoStatus): void => {
  const { tasks, ...repoWithoutTasks } = repo;
  logger.info(`Repo ${repo.name}`, { repo: repoWithoutTasks });

  if (repo.tasks.length === 0) {
    logger.info("  (no tasks)");
  } else {
    for (const task of repo.tasks) {
      const changeName = task.changePath.split("/").pop();
      const taskLine = `${task.id}  ${task.status.padEnd(7)}  ${changeName}`;
      logger.info(taskLine);
    }
  }
  logger.info("");
};

const printFullStatus = (status: StatusResponse): void => {
  const { globalCapacity, repos } = status;

  logger.info("Global capacity: {working}/{max} working", {
    working: globalCapacity.working,
    max: globalCapacity.max,
  });

  if (repos.length === 0) {
    logger.info("\nNo repositories registered");
    return;
  }

  logger.info("");
  repos.forEach(printRepoStatus);
};

const printTaskDetails = (task: Task): void => {
  logger.info("Task: {id}", { id: task.id });
  logger.info("Status: {status}", { status: task.status });
  logger.info("Repository ID: {repoId}", { repoId: task.repoId });
  logger.info("Change: {changePath}", { changePath: task.changePath });
  logger.info("Created: {createdAt}", { createdAt: task.createdAt });
  logger.info("Updated: {updatedAt}", { updatedAt: task.updatedAt });
};
