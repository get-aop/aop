import {
  ChevronDownIcon,
  FolderKanbanIcon,
  LayoutGridIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/ui/sidebar";
import { AopLogoMark } from "../components/brand/AopLogoMark";
import { ProjectRow } from "../projects/ProjectRow";
import { useProjectsState } from "../projects/ProjectsProvider";
import { usePinnedProjects } from "../projects/project-preferences";
import type { ProjectEntry } from "../projects/projects-state";
import { groupProjects, hostConnection } from "../projects/selectors";
import { openSettingsDialog } from "./dialog-store";
import { Link, projectsPath, routeProjectId, useRoute } from "./router";
import { SidebarFooterStatus } from "./sidebar-footer";

/**
 * The app's only chrome: brand and search, New project, every project with what needs
 * attention in it (pinned first, archived folded away), then Settings and the connection.
 */
export const ProjectsSidebar = ({
  onOpenCommand,
  onNewProject,
}: {
  onOpenCommand: () => void;
  onNewProject: () => void;
}) => {
  const state = useProjectsState();
  const route = useRoute();
  const { pinnedIds } = usePinnedProjects();
  const activeId = routeProjectId(route);
  const groups = useMemo(
    () => groupProjects(Object.values(state.byId), pinnedIds),
    [state.byId, pinnedIds],
  );
  const empty = state.phase === "ready" && Object.keys(state.byId).length === 0;

  return (
    <Sidebar data-testid="projects-sidebar">
      <SidebarHeader className="gap-1 p-2">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="sidebar-brand"
                className="flex h-8 flex-1 items-center gap-1.5 rounded-row px-2 text-[14px] font-semibold text-text transition-colors duration-[120ms] hover:bg-hover"
              >
                <AopLogoMark size={20} />
                AOP
                <ChevronDownIcon className="size-3.5 text-text-subtle" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => openSettingsDialog("about")}>
                About AOP
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            data-testid="sidebar-search"
            aria-label="Find a project (⌘K)"
            onClick={onOpenCommand}
            className="grid size-8 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
          >
            <SearchIcon className="size-4" strokeWidth={1.7} />
          </button>
        </div>
        <button
          type="button"
          data-testid="sidebar-new-project"
          onClick={onNewProject}
          className="flex h-8 items-center gap-2 rounded-row px-2 text-[13px] font-medium text-text transition-colors duration-[120ms] hover:bg-hover"
        >
          <SquarePenIcon className="size-4 text-text-muted" strokeWidth={1.7} />
          <span className="flex-1 text-left">New project</span>
          <kbd className="text-[11px] text-text-subtle">⌘N</kbd>
        </button>
        <Link
          to={projectsPath()}
          data-testid="sidebar-all-projects"
          aria-current={route.name === "projects" ? "page" : undefined}
          className="flex h-8 items-center gap-2 rounded-row px-2 text-[13px] font-medium text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text aria-[current=page]:bg-active aria-[current=page]:text-text"
        >
          <LayoutGridIcon className="size-4" strokeWidth={1.7} />
          All projects
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-3 px-2 pt-2" data-testid="sidebar-projects">
        {state.phase === "loading" ? (
          <p className="px-2 text-[12px] text-text-subtle">Loading projects…</p>
        ) : null}
        {state.phase === "error" ? (
          <p data-testid="sidebar-error" className="px-2 text-[12px] text-blocked">
            Could not load projects. {state.error}
          </p>
        ) : null}
        {empty ? <NoProjects onNewProject={onNewProject} /> : null}
        <ProjectGroup
          label="Pinned"
          entries={groups.pinned}
          activeId={activeId}
          testId="sidebar-pinned"
        />
        <ProjectGroup
          label="Projects"
          entries={groups.active}
          activeId={activeId}
          testId="sidebar-active"
        />
        {groups.archived.length > 0 ? (
          <Collapsible data-testid="sidebar-archived">
            <CollapsibleTrigger className="flex h-7 w-full items-center gap-1.5 rounded-row px-2 text-[11.5px] font-medium text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text">
              <ChevronDownIcon className="size-3.5 transition-transform [[data-state=closed]>&]:-rotate-90" />
              Archived · {groups.archived.length}
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-0.5 pt-0.5">
              {groups.archived.map((entry) => (
                <ProjectRow
                  key={entry.project.id}
                  entry={entry}
                  active={entry.project.id === activeId}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="border-t border-border p-0">
        <SidebarFooterStatus connection={hostConnection(state)} />
      </SidebarFooter>
    </Sidebar>
  );
};

const ProjectGroup = ({
  label,
  entries,
  activeId,
  testId,
}: {
  label: string;
  entries: ProjectEntry[];
  activeId: string | null;
  testId: string;
}) =>
  entries.length === 0 ? null : (
    <section data-testid={testId} className="flex flex-col gap-0.5">
      <h2 className="px-2 pb-1 text-[11.5px] font-medium text-text-subtle">{label}</h2>
      {entries.map((entry) => (
        <ProjectRow key={entry.project.id} entry={entry} active={entry.project.id === activeId} />
      ))}
    </section>
  );

const NoProjects = ({ onNewProject }: { onNewProject: () => void }) => (
  <div
    data-testid="sidebar-empty"
    className="flex flex-col items-center gap-3 px-4 py-6 text-center"
  >
    <FolderKanbanIcon className="size-5 text-text-subtle" strokeWidth={1.5} />
    <div className="flex flex-col gap-1">
      <p className="text-[13px] font-medium text-text">No projects yet</p>
      <p className="text-[12px] text-text-subtle">
        A project is one coordinator chat and the threads it starts.
      </p>
    </div>
    <button
      type="button"
      onClick={onNewProject}
      className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-raised px-2.5 text-[12px] font-medium text-text transition-colors duration-[120ms] hover:bg-hover"
    >
      <PlusIcon className="size-3 shrink-0" />
      New project
    </button>
  </div>
);
