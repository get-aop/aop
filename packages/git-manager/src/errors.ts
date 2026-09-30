export class WorktreeExistsError extends Error {
  constructor(public readonly taskId: string) {
    super(`Worktree already exists for task: ${taskId}`);
    this.name = "WorktreeExistsError";
  }
}

export class BranchNotFoundError extends Error {
  constructor(public readonly branch: string) {
    super(`Branch not found: ${branch}`);
    this.name = "BranchNotFoundError";
  }
}

export class DirtyWorktreeError extends Error {
  constructor(public readonly taskId: string) {
    super(`Worktree has uncommitted changes: ${taskId}`);
    this.name = "DirtyWorktreeError";
  }
}

export class WorktreeNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Worktree not found for task: ${taskId}`);
    this.name = "WorktreeNotFoundError";
  }
}

export class NotAGitRepositoryError extends Error {
  constructor(public readonly path: string) {
    super(`Not a git repository: ${path}`);
    this.name = "NotAGitRepositoryError";
  }
}
