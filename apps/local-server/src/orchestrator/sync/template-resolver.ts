import { getLogger } from "@aop/infra";
import Handlebars from "handlebars";

const logger = getLogger("template-resolver");

export interface WorktreeContext {
  path: string;
  branch: string;
}

export interface TaskContext {
  id: string;
  changePath: string;
  docsDir: string;
  repositories: TaskRepositoryContext[];
  attachments: TaskAttachmentContext[];
}

export interface TaskAttachmentContext {
  /** Inline marker the task text uses to reference the file, e.g. `#image1`. */
  label: string;
  /** Absolute path of the attachment file. */
  path: string;
}

export interface TaskRepositoryContext {
  repoId: string;
  assignment: string;
  path: string;
  writable: boolean;
}

export interface StepContext {
  type: string;
  executionId: string;
  iteration: number;
}

export interface SignalContext {
  name: string;
  description: string;
}

export interface TemplateContext {
  worktree: WorktreeContext;
  task: TaskContext;
  step: StepContext;
  signals?: SignalContext[];
  input?: string;
}

export const resolveTemplate = (template: string, context: TemplateContext): string => {
  const log = logger.with({ taskId: context.task.id, stepType: context.step.type });

  try {
    const compiled = Handlebars.compile(template, { noEscape: true });
    const resolved = compiled(context);

    log.debug("Template resolved successfully");
    return resolved;
  } catch (err) {
    log.error("Failed to resolve template: {error}", { error: String(err) });
    throw new TemplateResolutionError(`Failed to resolve template: ${err}`);
  }
};

export const validateTemplate = (template: string): string[] => {
  const placeholderPattern = /\{\{\s*([\w.]+)\s*\}\}/g;
  const validPlaceholders = new Set([
    "worktree.path",
    "worktree.branch",
    "task.id",
    "task.changePath",
    "task.docsDir",
    "task.repositories",
    "task.attachments",
    "step.type",
    "step.executionId",
    "step.iteration",
    "this.repoId",
    "this.assignment",
    "this.path",
    "this.writable",
    "this.label",
    "input",
    "this.name",
    "this.description",
  ]);

  const unknownPlaceholders: string[] = [];
  const matches = template.matchAll(placeholderPattern);

  for (const match of matches) {
    const placeholder = match[1];
    if (placeholder && !validPlaceholders.has(placeholder)) {
      unknownPlaceholders.push(placeholder);
    }
  }

  return unknownPlaceholders;
};

export class TemplateResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateResolutionError";
  }
}

export const createTemplateContext = (params: {
  worktreePath: string;
  worktreeBranch: string;
  taskId: string;
  changePath: string;
  docsDir?: string;
  repositories?: TaskRepositoryContext[];
  attachments?: TaskAttachmentContext[];
  stepType: string;
  executionId: string;
  iteration: number;
  signals?: SignalContext[];
  input?: string;
}): TemplateContext => {
  const docsDir = params.docsDir ?? params.changePath;

  return {
    worktree: {
      path: params.worktreePath,
      branch: params.worktreeBranch,
    },
    task: {
      id: params.taskId,
      changePath: params.changePath,
      docsDir,
      repositories: params.repositories ?? [],
      attachments: params.attachments ?? [],
    },
    step: {
      type: params.stepType,
      executionId: params.executionId,
      iteration: params.iteration,
    },
    signals: params.signals,
    input: params.input,
  };
};
