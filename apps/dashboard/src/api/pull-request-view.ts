import type {
  PullRequestCommentBody,
  PullRequestMergeBody,
  PullRequestReviewBody,
  PullRequestUpdateBody,
  PullRequestViewChecksResponse,
  PullRequestViewDetail,
  PullRequestViewFilesResponse,
} from "@aop/common";
import { type ConditionalRead, request, requestIfChanged } from "./request";

/** Which pull request: the project, one of its repositories (AOP's id), and the number. */
export interface PullRequestKey {
  projectId: string;
  repoId: string;
  number: number;
}

const pullUrl = ({ projectId, repoId, number }: PullRequestKey, suffix = ""): string =>
  `/projects/${encodeURIComponent(projectId)}/github/repos/${encodeURIComponent(repoId)}/pulls/${number}${suffix}`;

/** The page; `refresh` asks the host to read GitHub again instead of its few-second cache. */
export const getPullRequestView = (
  key: PullRequestKey,
  etag: string | null,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<ConditionalRead<PullRequestViewDetail>> =>
  requestIfChanged(pullUrl(key, refresh ? "?refresh=1" : ""), etag);

export const getPullRequestChecks = (
  key: PullRequestKey,
  etag: string | null,
): Promise<ConditionalRead<PullRequestViewChecksResponse>> =>
  requestIfChanged(pullUrl(key, "/checks"), etag);

export const getPullRequestFiles = (key: PullRequestKey): Promise<PullRequestViewFilesResponse> =>
  request(pullUrl(key, "/files"));

const write = (key: PullRequestKey, method: string, suffix: string, body: unknown) =>
  request<{ ok: true }>(pullUrl(key, suffix), { method, body: JSON.stringify(body) });

export const commentOnPullRequest = (key: PullRequestKey, body: PullRequestCommentBody) =>
  write(key, "POST", "/comments", body);

export const reviewPullRequest = (key: PullRequestKey, body: PullRequestReviewBody) =>
  write(key, "POST", "/reviews", body);

export const mergePullRequest = (key: PullRequestKey, body: PullRequestMergeBody) =>
  write(key, "POST", "/merge", body);

export const updatePullRequest = (key: PullRequestKey, body: PullRequestUpdateBody) =>
  write(key, "PATCH", "", body);
