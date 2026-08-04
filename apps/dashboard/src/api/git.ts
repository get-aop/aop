import type {
  CreateSessionPrMode,
  CreateSessionPrResult,
  MergeSessionPrMethod,
  SessionDiffFile,
  SessionGitBranchList,
  SessionGitDiff,
  SessionGitStatus,
  SessionPullRequestStateStatus,
  SessionPullRequestStatus,
  SwitchSessionGitBranchResult,
} from "@aop/common";
import { request } from "./request";

export const getSessionGitStatus = async (sessionId: string): Promise<SessionGitStatus> =>
  request<SessionGitStatus>(`/chat-sessions/${sessionId}/git/status`);

export const listSessionGitBranches = async (sessionId: string): Promise<SessionGitBranchList> =>
  request<SessionGitBranchList>(`/chat-sessions/${sessionId}/git/branches`);

export const switchSessionGitBranch = async (
  sessionId: string,
  branch: string,
): Promise<SwitchSessionGitBranchResult> =>
  request<SwitchSessionGitBranchResult>(`/chat-sessions/${sessionId}/git/branch`, {
    method: "POST",
    body: JSON.stringify({ branch }),
  });

export type CreateSessionPullRequestResponse = CreateSessionPrResult;

export const createSessionPullRequest = async (
  sessionId: string,
  mode: CreateSessionPrMode,
): Promise<CreateSessionPullRequestResponse> =>
  request<CreateSessionPullRequestResponse>(`/chat-sessions/${sessionId}/git/pr`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });

export const getSessionPullRequestState = async (
  sessionId: string,
): Promise<SessionPullRequestStateStatus> =>
  request<SessionPullRequestStateStatus>(`/chat-sessions/${sessionId}/git/pr/state`);

export const getSessionPullRequestStatus = async (
  sessionId: string,
): Promise<SessionPullRequestStatus> =>
  request<SessionPullRequestStatus>(`/chat-sessions/${sessionId}/git/pr/status`);

export const mergeSessionPullRequest = async (
  sessionId: string,
  method: MergeSessionPrMethod,
): Promise<SessionPullRequestStatus> =>
  request<SessionPullRequestStatus>(`/chat-sessions/${sessionId}/git/pr/merge`, {
    method: "POST",
    body: JSON.stringify({ method }),
  });

/** Summary-only: paths + stats, no hunks. Bodies load via getSessionGitDiffFile. */
export const getSessionGitDiff = async (sessionId: string): Promise<SessionGitDiff> =>
  request<SessionGitDiff>(`/chat-sessions/${sessionId}/git/diff`);

export const getSessionGitDiffFile = async (
  sessionId: string,
  path: string,
): Promise<SessionDiffFile> =>
  request<SessionDiffFile>(
    `/chat-sessions/${sessionId}/git/diff/file?path=${encodeURIComponent(path)}`,
  );

export interface CommitSessionGitResult {
  committed: boolean;
  pushed: boolean;
  branch: string;
}

export const commitSessionGit = async (
  sessionId: string,
  input: { push: boolean },
): Promise<CommitSessionGitResult> =>
  request<CommitSessionGitResult>(`/chat-sessions/${sessionId}/git/commit`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export interface CreateSessionWorktreeResult {
  worktree: { path: string; branch: string; baseBranch: string };
  session: { id: string; workspacePath: string };
}

export const createSessionWorktree = async (
  sessionId: string,
  input: { branchName?: string; baseBranch?: string } = {},
): Promise<CreateSessionWorktreeResult> =>
  request<CreateSessionWorktreeResult>(`/chat-sessions/${sessionId}/worktree`, {
    method: "POST",
    body: JSON.stringify(input),
  });
