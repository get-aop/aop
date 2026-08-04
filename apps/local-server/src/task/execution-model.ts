import {
  canExecutionPhaseLaunchDeveloperWork,
  clampDeveloperExecutionSlots,
  type DeveloperTaskAssignment,
  isRepositoryAssignmentWritable,
  type RepositoryAssignment,
  readPrimaryRepository,
  type TaskExecutionModel,
} from "@aop/common";
import type { Task } from "../db/schema.ts";
import type { RepoRepository } from "../repo/repository.ts";
import { resolveTaskFilePath } from "../task-docs/paths.ts";
import { readTaskExecutionModel } from "../task-docs/task.ts";

export interface TaskRepositoryScope {
  repoId: string;
  repoPath: string;
  assignment: RepositoryAssignment;
  writable: boolean;
}

export interface TaskExecutionContext {
  model: TaskExecutionModel | null;
  developerAssignment: DeveloperTaskAssignment | null;
  repositories: TaskRepositoryScope[];
  primaryRepository: TaskRepositoryScope;
}

export class InvalidTaskExecutionModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskExecutionModelError";
  }
}

interface ValidateTaskExecutionModelParams {
  model: TaskExecutionModel;
  taskRepoId: string;
  registeredRepoIds: Set<string>;
}

const buildDefaultExecutionContext = (task: Task, repoPath: string): TaskExecutionContext => {
  const primaryRepository: TaskRepositoryScope = {
    repoId: task.repo_id,
    repoPath,
    assignment: "primary",
    writable: true,
  };

  return {
    model: null,
    developerAssignment: null,
    repositories: [primaryRepository],
    primaryRepository,
  };
};

const collectReferencedRepositoryIds = (model: TaskExecutionModel): Set<string> => {
  const repoIds = new Set<string>();

  for (const repository of model.architect.repositories) {
    repoIds.add(repository.repoId);
  }

  for (const developer of model.developers) {
    for (const repository of developer.repositories) {
      repoIds.add(repository.repoId);
    }
  }

  return repoIds;
};

export const validateTaskExecutionModelForDeveloperRuntime = ({
  model,
  taskRepoId,
  registeredRepoIds,
}: ValidateTaskExecutionModelParams): string[] => {
  const errors: string[] = [];

  if (model.developers.length !== model.guardrails.maxDeveloperAssignmentsPerTask) {
    errors.push("Current local runtime supports exactly one developer assignment per task");
  }

  const developer = model.developers[0];
  if (!developer) {
    return errors;
  }

  if (!canExecutionPhaseLaunchDeveloperWork(model.coordinationPhase, developer.lifecycle)) {
    errors.push(
      `Coordination phase '${model.coordinationPhase}' cannot launch developer lifecycle '${developer.lifecycle}'`,
    );
  }

  const primaryRepository = readPrimaryRepository(developer);
  if (!primaryRepository || primaryRepository.repoId !== taskRepoId) {
    errors.push(
      "Developer primary repository must match the task repository in the current runtime",
    );
  }

  for (const repoId of collectReferencedRepositoryIds(model)) {
    if (!registeredRepoIds.has(repoId)) {
      errors.push(`Execution model references unregistered repository '${repoId}'`);
    }
  }

  return errors;
};

const resolveRegisteredRepositoryIds = async (
  repoRepository: RepoRepository,
): Promise<Set<string>> => {
  const repos = await repoRepository.getAll();
  return new Set(repos.map((repo) => repo.id));
};

export const getEffectiveDeveloperExecutionSlots = (configuredSlots: number): number => {
  return clampDeveloperExecutionSlots(configuredSlots);
};

export const resolveTaskExecutionContext = async (
  task: Task,
  repoPath: string,
  repoRepository: RepoRepository,
): Promise<TaskExecutionContext> => {
  const taskExecution = await readTaskExecutionModel(
    resolveTaskFilePath(task.repo_id, repoPath, task.change_path),
  );
  if (taskExecution.error) {
    throw new InvalidTaskExecutionModelError(taskExecution.error);
  }

  if (!taskExecution.model) {
    return buildDefaultExecutionContext(task, repoPath);
  }

  const validationErrors = validateTaskExecutionModelForDeveloperRuntime({
    model: taskExecution.model,
    taskRepoId: task.repo_id,
    registeredRepoIds: await resolveRegisteredRepositoryIds(repoRepository),
  });

  if (validationErrors.length > 0) {
    throw new InvalidTaskExecutionModelError(validationErrors[0] ?? "Invalid task execution model");
  }

  const developerAssignment = taskExecution.model.developers[0];
  if (!developerAssignment) {
    throw new InvalidTaskExecutionModelError(
      "Execution model must include one developer assignment",
    );
  }

  const repositories: TaskRepositoryScope[] = [];
  for (const repository of developerAssignment.repositories) {
    const repo = await repoRepository.getById(repository.repoId);
    if (!repo) {
      throw new InvalidTaskExecutionModelError(
        `Execution model references unregistered repository '${repository.repoId}'`,
      );
    }

    repositories.push({
      repoId: repo.id,
      repoPath: repo.path,
      assignment: repository.assignment,
      writable: isRepositoryAssignmentWritable(repository.assignment),
    });
  }

  const primaryRepository = repositories.find((repository) => repository.assignment === "primary");
  if (!primaryRepository) {
    throw new InvalidTaskExecutionModelError(
      "Developer assignments must declare exactly one primary repository",
    );
  }

  return {
    model: taskExecution.model,
    developerAssignment,
    repositories,
    primaryRepository,
  };
};
