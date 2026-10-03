import {
  isProjectScreen,
  navigate,
  type ProjectScreen,
  parseRoute,
  projectScreenPath,
} from "../../../shell/router";

/**
 * Shows an issue where the coordinator chat is, as a new history entry, so back returns to what
 * was there; the PR View's `openPullRequestView` works the same way. The threads panel keeps its
 * place (the Issues tab stays open beside it), and the chat stays mounted underneath with its
 * scroll and its draft.
 */
export const openIssueView = (projectId: string, key: string): void => {
  navigate(projectScreenPath({ ...screenUnder(projectId), issue: key }));
};

/** Gives the chat its place back; the panel stays as it is. */
export const closeIssueView = (): void => {
  const route = parseRoute(window.location.pathname);
  if (!route || !isProjectScreen(route) || !route.issue) return;
  const { issue: _closed, ...screen } = route;
  navigate(projectScreenPath(screen));
};

// The panel keeps what it shows; whatever was in the chat's place gives way.
const screenUnder = (projectId: string): ProjectScreen => {
  const route = parseRoute(window.location.pathname);
  if (route?.name === "thread" && route.projectId === projectId) {
    return { name: "thread", projectId, threadId: route.threadId };
  }
  if (route?.name === "project-tab" && route.projectId === projectId) {
    return { name: "project-tab", projectId, tab: route.tab };
  }
  return { name: "project", projectId };
};
