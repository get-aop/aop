import { Link, projectsPath, type Route } from "../shell/router";
import { useProjectChat } from "./chat/use-project-chat";
import { ProjectLayout } from "./layout/ProjectLayout";
import { useProjectEntry, useProjectsState } from "./ProjectsProvider";
import { ProjectTopBar } from "./ProjectTopBar";
import { ProjectSettingsPane } from "./settings/ProjectSettingsPane";

type ProjectRoute = Exclude<Route, { name: "projects" }>;

/**
 * One project: the three-pane screen (chat and threads panel) for its home and its threads,
 * or its settings on a screen of their own, under the same top bar.
 */
export const ProjectPage = ({ route }: { route: ProjectRoute }) => {
  const entry = useProjectEntry(route.projectId);
  const { phase } = useProjectsState();
  const { chat, model } = useProjectChat(route.projectId, entry !== undefined);

  if (!entry) {
    return phase === "ready" ? <ProjectNotFound /> : <ProjectLoading />;
  }

  return (
    <div
      data-testid="project-page"
      data-project-id={entry.project.id}
      className="flex h-full flex-col"
    >
      {route.name === "project-settings" ? (
        <>
          <ProjectTopBar entry={entry} panel={null} settingsOpen />
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <ProjectSettingsPane entry={entry} section={route.section} />
          </main>
        </>
      ) : (
        <ProjectLayout
          key={entry.project.id}
          entry={entry}
          route={route}
          chat={chat}
          model={model}
        />
      )}
    </div>
  );
};

const ProjectLoading = () => (
  <p data-testid="project-loading" className="p-6 text-body text-text-subtle">
    Loading project…
  </p>
);

const ProjectNotFound = () => (
  <div
    data-testid="project-not-found"
    className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
  >
    <h1 className="text-title font-medium text-text">This project does not exist</h1>
    <p className="max-w-sm text-body text-text-subtle">
      It may have been deleted, or the link is wrong.
    </p>
    <Link to={projectsPath()} className="mt-2 text-body text-running hover:underline">
      Back to all projects
    </Link>
  </div>
);
