import { useRef } from "react";
import { AppTopBar } from "../shell/AppTopBar";
import {
  Link,
  navigate,
  type ProjectScreen,
  projectScreenPath,
  projectsPath,
  type Route,
} from "../shell/router";
import { useProjectChat } from "./chat/use-project-chat";
import { ProjectLayout } from "./layout/ProjectLayout";
import { useProjectEntry, useProjectsState } from "./ProjectsProvider";
import { ProjectSettingsDialog } from "./settings/ProjectSettingsDialog";

type ProjectRoute = Exclude<Route, { name: "projects" }>;

/**
 * One project: the three-pane screen (chat and threads panel) for its home and its threads.
 * Its settings open in a dialog over that screen, which stays mounted underneath: the chat keeps
 * its draft and its place, and closing the settings goes back to what was open before.
 */
export const ProjectPage = ({ route }: { route: ProjectRoute }) => {
  const entry = useProjectEntry(route.projectId);
  const { phase } = useProjectsState();
  const { chat, model } = useProjectChat(route.projectId, entry !== undefined);
  const screen = useScreenUnderSettings(route);

  if (!entry) {
    return phase === "ready" ? <ProjectNotFound /> : <ProjectLoading />;
  }

  return (
    <div
      data-testid="project-page"
      data-project-id={entry.project.id}
      className="flex h-full flex-col"
    >
      <ProjectLayout
        key={entry.project.id}
        entry={entry}
        route={screen}
        chat={chat}
        model={model}
        settingsOpen={route.name === "project-settings"}
      />
      {route.name === "project-settings" ? (
        <ProjectSettingsDialog
          entry={entry}
          section={route.section}
          onClose={() => navigate(projectScreenPath(screen))}
        />
      ) : null}
    </div>
  );
};

/**
 * The screen the settings open over: the last project or thread screen of this project, or its
 * home when the settings were the first thing opened (a deep link).
 */
const useScreenUnderSettings = (route: ProjectRoute): ProjectScreen => {
  const last = useRef<ProjectScreen>({ name: "project", projectId: route.projectId });
  if (route.name !== "project-settings") last.current = route;
  else if (last.current.projectId !== route.projectId) {
    last.current = { name: "project", projectId: route.projectId };
  }
  return last.current;
};

const ProjectLoading = () => (
  <div className="flex h-full flex-col">
    <AppTopBar />
    <p data-testid="project-loading" className="p-6 text-body text-text-subtle">
      Loading project…
    </p>
  </div>
);

const ProjectNotFound = () => (
  <div className="flex h-full flex-col">
    <AppTopBar />
    <div
      data-testid="project-not-found"
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <h1 className="text-title font-medium text-text">This project does not exist</h1>
      <p className="max-w-sm text-body text-text-subtle">
        It may have been deleted, or the link is wrong.
      </p>
      <Link to={projectsPath()} className="mt-2 text-body text-running hover:underline">
        Back to all projects
      </Link>
    </div>
  </div>
);
