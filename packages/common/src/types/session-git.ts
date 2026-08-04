/**
 * Session git/PR wire types shared by the local server (producer) and the
 * dashboard (consumer). Keep them JSON-shaped: no classes, no server deps.
 */

export interface SessionGitDiffstat {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export type SessionPullRequestState = "open" | "closed" | "merged";

export interface SessionGitPullRequest {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  title: string;
}

export interface SessionPullRequestStateStatus {
  state: SessionPullRequestState | null;
}

export interface SessionGitStatus {
  isGitRepo: boolean;
  branch: string | null;
  defaultBranch: string | null;
  isOnDefaultBranch: boolean;
  dirty: boolean;
  diffstat: SessionGitDiffstat;
  aheadOfBase: number;
  ghAvailable: boolean;
  pr: SessionGitPullRequest | null;
  prState: "open" | "closed" | "merged" | null;
}

export interface SessionGitBranch {
  name: string;
  isCurrent: boolean;
  isDefault: boolean;
  worktreePath: string | null;
}

export interface SessionGitBranchList {
  branches: SessionGitBranch[];
}

export interface SwitchSessionGitBranchResult {
  branch: string;
  workspacePath: string;
}

export type SessionDiffLineType = "context" | "add" | "del";

export interface SessionDiffLine {
  type: SessionDiffLineType;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface SessionDiffHunk {
  oldStart: number;
  newStart: number;
  lines: SessionDiffLine[];
}

export type SessionDiffFileStatus = "added" | "modified" | "deleted" | "renamed" | "binary";

export interface SessionDiffFile {
  path: string;
  oldPath: string | null;
  status: SessionDiffFileStatus;
  additions: number;
  deletions: number;
  truncated: boolean;
  hunks: SessionDiffHunk[];
  /**
   * When true, `hunks` are omitted intentionally (summary response).
   * Clients must fetch the per-file payload before rendering the body.
   */
  detailsPending?: boolean;
}

export interface SessionGitDiff {
  defaultBranch: string | null;
  files: SessionDiffFile[];
  /** Target line budget; changed rows are retained even when they exceed it. */
  perFileLineCap: number;
  /**
   * Summary-only responses list every changed path without hunk bodies.
   * Fetch `GET .../git/diff/file?path=` for each expanded file.
   */
  summaryOnly?: boolean;
}

export type CreateSessionPrMode = "create" | "draft" | "manual";

export type CreateSessionPrResult =
  | { number: number; url: string; state: "OPEN"; created: boolean }
  | { compareUrl: string; created: false };

export type MergeSessionPrMethod = "squash" | "merge" | "rebase";

export interface SessionPullRequestCheck {
  name: string;
  workflow: string;
  state: string;
  bucket: string;
  link: string;
  startedAt: string | null;
  completedAt: string | null;
  description: string | null;
}

export interface SessionMergedPullRequest {
  number: number;
  url: string;
  title: string;
  authorLogin: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergedAt: string | null;
  repoNameWithOwner: string;
}

export interface SessionPullRequestRef {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  mergeable: string;
  baseRefName: string;
  headRefName: string;
}

export interface SessionPullRequestStatus {
  pr: SessionPullRequestRef | null;
  /** null when there is no PR, the PR reports no checks, or the PR is merged/closed. */
  checksState: "pending" | "success" | "failure" | null;
  checks: SessionPullRequestCheck[];
  /** Populated only when the PR state is MERGED. */
  merged: SessionMergedPullRequest | null;
}
