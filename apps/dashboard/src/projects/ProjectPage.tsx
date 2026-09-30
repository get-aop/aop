import { Link, projectsPath, type Route } from "../shell/router";
import { ProjectHeader } from "./ProjectHeader";
import { useProjectEntry, useProjectsState } from "./ProjectsProvider";
import { CoordinatorChatPane, ThreadPane } from "./panes";
import { ProjectSettingsPane } from "./settings/ProjectSettingsPane";
import { ThreadGrid } from "./ThreadGrid";

type ProjectRoute = Exclude<Route, { name: "projects" }>;

/** One project: its header, then the screen the route names. */
export const ProjectPage = ({ route }: { route: ProjectRoute }) => {
  const entry = useProjectEntry(route.projectId);
  const { phase } = useProjectsState();

  if (!entry) {
    return phase === "ready" ? <ProjectNotFound /> : <ProjectLoading />;
  }

  const { project, threads } = entry;
  return (
    <div data-testid="project-page" data-project-id={project.id} className="flex h-full flex-col">
      <ProjectHeader entry={entry} route={route} />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {route.name === "project" ? <ThreadGrid entry={entry} /> : null}
        {route.name === "coordinator" ? (
          <CoordinatorChatPane project={project} threads={threads} />
        ) : null}
        {route.name === "thread" ? (
          <ThreadPane
            project={project}
            thread={threads.find((thread) => thread.id === route.threadId)}
          />
        ) : null}
        {route.name === "project-settings" ? (
          <ProjectSettingsPane entry={entry} section={route.section} />
        ) : null}
      </main>
    </div>
  );
};

const ProjectLoading = () => (
  <p data-testid="project-loading" className="p-6 text-[13px] text-text-subtle">
    Loading project…
  </p>
);

const ProjectNotFound = () => (
  <div
    data-testid="project-not-found"
    className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
  >
    <h1 className="text-[15px] font-medium text-text">This project does not exist</h1>
    <p className="max-w-sm text-[13px] text-text-subtle">
      It may have been deleted, or the link is wrong.
    </p>
    <Link to={projectsPath()} className="mt-2 text-[13px] text-running hover:underline">
      Back to all projects
    </Link>
  </div>
);
