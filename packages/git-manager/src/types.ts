export interface GitManagerOptions {
  repoPath: string;
  repoId: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
}
