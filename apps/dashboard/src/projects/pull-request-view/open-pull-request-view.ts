import {
  isProjectScreen,
  navigate,
  type ProjectScreen,
  parseRoute,
  projectScreenPath,
} from "../../shell/router";

/** Which pull request to show: one of the project's repositories (AOP's repo id) and its number. */
export interface PullRequestViewTarget {
  projectId: string;
  repoId: string;
  number: number;
}

/**
 * Shows a pull request where the coordinator chat is, as a new history entry, so back returns to
 * what was there. The threads panel keeps its place: a thread or a tab of the same project that
 * is open stays open beside it. The chat stays mounted underneath and keeps its scroll and its draft.
 */
export const openPullRequestView = ({ projectId, repoId, number }: PullRequestViewTarget): void => {
  navigate(projectScreenPath({ ...screenUnder(projectId), pullRequest: { repoId, number } }));
};

/** Gives the chat its place back; the threads panel stays as it is. */
export const closePullRequestView = (): void => {
  const route = parseRoute(window.location.pathname);
  if (!route || !isProjectScreen(route) || !route.pullRequest) return;
  const { pullRequest: _closed, ...screen } = route;
  navigate(projectScreenPath(screen));
};

/** The panel as it is now (a thread or a tab of the same project), without the pull request. */
const screenUnder = (projectId: string): ProjectScreen => {
  const route = parseRoute(window.location.pathname);
  if (!route || !isProjectScreen(route) || route.projectId !== projectId) {
    return { name: "project", projectId };
  }
  // An issue open in the view gives way; the pull request it links to takes its place.
  const { pullRequest: _replaced, issue: _issue, ...screen } = route;
  return screen;
};
