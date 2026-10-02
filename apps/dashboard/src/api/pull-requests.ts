import {
  type PullRequestListQueryInput,
  type PullRequestListResponse,
  PullRequestListResponseSchema,
} from "@aop/common";
import { request } from "./request";

/** The project's pull requests across its GitHub repositories, read by the host's `gh`. */
export const listPullRequests = async (
  projectId: string,
  query: PullRequestListQueryInput,
  init: { signal?: AbortSignal } = {},
): Promise<PullRequestListResponse> =>
  PullRequestListResponseSchema.parse(
    await request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/github/pulls${pullRequestSearch(query)}`,
      init,
    ),
  );

/** `?state=..&author=a&author=b..`: a filter with several values repeats; defaults are left out. */
export const pullRequestSearch = (query: PullRequestListQueryInput): string => {
  const params = new URLSearchParams();
  const set = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") params.append(name, String(value));
  };
  set("state", query.state);
  for (const author of query.author ?? []) set("author", author);
  for (const label of query.label ?? []) set("label", label);
  for (const assignee of query.assignee ?? []) set("assignee", assignee);
  set("q", query.q?.trim());
  set("sort", query.sort);
  if (query.involves) set("involves", 1);
  set("cursor", query.cursor);
  set("limit", query.limit);
  if (query.refresh) set("refresh", 1);
  const text = params.toString();
  return text ? `?${text}` : "";
};
