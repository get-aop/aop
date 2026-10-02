import {
  type ArtifactViewRef,
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
  if (route?.name !== "project" && route?.name !== "thread") return;
  if (!route.artifact) return;
  const { artifact: _closed, ...screen } = route;
  navigate(projectScreenPath(screen));
};

const screenUnder = (projectId: string): ProjectScreen => {
  const route = parseRoute(window.location.pathname);
  return route?.name === "thread" && route.projectId === projectId
    ? { name: "thread", projectId, threadId: route.threadId }
    : { name: "project", projectId };
};
