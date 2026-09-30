import type { ProjectUsage } from "@aop/common";
import { request } from "./request";

/** Runs that finished at or after `since` and before `until`; a missing bound is open. */
export interface UsageRange {
  since: string | null;
  until: string | null;
}

export const getProjectUsage = (projectId: string, range: UsageRange): Promise<ProjectUsage> => {
  const query = new URLSearchParams();
  if (range.since) query.set("since", range.since);
  if (range.until) query.set("until", range.until);
  const suffix = query.size > 0 ? `?${query}` : "";
  return request<ProjectUsage>(`/usage/projects/${encodeURIComponent(projectId)}${suffix}`);
};
