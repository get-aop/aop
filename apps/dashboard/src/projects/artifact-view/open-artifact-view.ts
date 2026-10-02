import {
  type ArtifactViewRef,
  isProjectScreen,
  navigate,
  type ProjectScreen,
  parseRoute,
  projectScreenPath,
} from "../../shell/router";

/**
 * Shows an artifact where the coordinator chat is, as a new history entry, so back returns to
 * what was there; the PR View's `openPullRequestView` works the same way. The threads panel
 * keeps its place: a card clicked in a thread's chat opens beside that thread. The chat stays
 * mounted underneath with its scroll and its draft.
 *
 * - an artifact or any Library file: `{ kind: "artifact", id, version? }`
 * - a file a reply linked: `{ kind: "file", threadId, path }` (`threadId` null for the coordinator)
 * - a diagram of a reply being drawn: `{ kind: "visualize", messageId }`
 */
export const openArtifactView = (projectId: string, artifact: ArtifactViewRef): void => {
  navigate(projectScreenPath({ ...screenUnder(projectId), artifact }));
};

/** The same screen showing something else in the view, without a new history entry. */
export const replaceArtifactView = (projectId: string, artifact: ArtifactViewRef): void => {
  navigate(projectScreenPath({ ...screenUnder(projectId), artifact }), { replace: true });
};

/** Gives the chat its place back; the threads panel stays as it is. */
export const closeArtifactView = (): void => {
  const route = parseRoute(window.location.pathname);
  if (!route || !isProjectScreen(route) || !route.artifact) return;
  const { artifact: _closed, ...screen } = route;
  navigate(projectScreenPath(screen));
};

// The panel keeps what it shows: the thread open in it, or its tab (the Library, ...).
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
