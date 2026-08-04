/** Repo-level actions from the repository Actions menu. */
export const REPO_BULK_ACTIONS = ["git-pull"] as const;

export type RepoBulkAction = (typeof REPO_BULK_ACTIONS)[number];

export const isRepoBulkAction = (value: string): value is RepoBulkAction =>
  (REPO_BULK_ACTIONS as readonly string[]).includes(value);

export interface RepoBulkActionFailure {
  taskId: string;
  error: string;
}

/**
 * Aggregated outcome of a repo-level action. Repo-only actions (git-pull) use one
 * synthetic result row for the repository itself.
 */
export interface RepoBulkActionResult {
  action: RepoBulkAction;
  total: number;
  started: number;
  skipped: number;
  failed: number;
  failures: RepoBulkActionFailure[];
}
