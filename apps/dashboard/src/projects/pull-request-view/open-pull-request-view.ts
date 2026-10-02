import { navigate, type ProjectScreen, parseRoute, projectScreenPath } from "../../shell/router";

/** Which pull request to show: one of the project's repositories (AOP's repo id) and its number. */
export interface PullRequestViewTarget {
  projectId: string;
  repoId: string;
  number: number;
}

/**
 * Shows a pull request where the coordinator chat is, as a new history entry, so back returns to
 * what was there. The threads panel keeps its place: a thread of the same project that is open
 * stays open beside it. The chat stays mounted underneath and keeps its scroll and its draft.
 */
export const openPullRequestView = ({ projectId, repoId, number }: PullRequestViewTarget): void => {
  navigate(projectScreenPath({ ...screenUnder(projectId), pullRequest: { repoId, number } }));
};

/** Gives the chat its place back; the threads panel stays as it is. */
export const closePullRequestView = (): void => {
  const route = parseRoute(window.location.pathname);
  if (route?.name !== "project" && route?.name !== "thread") return;
  if (!route.pullRequest) return;
  const { pullRequest: _closed, ...screen } = route;
  navigate(projectScreenPath(screen));
};

const screenUnder = (projectId: string): ProjectScreen => {
  const route = parseRoute(window.location.pathname);
  return route?.name === "thread" && route.projectId === projectId
    ? { name: "thread", projectId, threadId: route.threadId }
    : { name: "project", projectId };
};
