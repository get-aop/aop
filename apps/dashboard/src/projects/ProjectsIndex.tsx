import { EllipsisIcon, FolderGitIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { openNewProjectDialog } from "../shell/dialog-store";
import { Link, projectPath } from "../shell/router";
import { ProjectMenu } from "./ProjectMenu";
import { useProjectsState } from "./ProjectsProvider";
import { ProjectTile } from "./ProjectTile";
import { usePinnedProjects } from "./project-preferences";
import type { ProjectEntry } from "./projects-state";
import {
  type Attention,
  attentionOf,
  attentionSentence,
  formatAge,
  groupProjects,
  matchesProjectSearch,
} from "./selectors";
import { useNow } from "./use-now";

/** `/`: every project as a card, with search and the way to start another. */
export const ProjectsIndex = () => {
  const state = useProjectsState();
  const { pinnedIds } = usePinnedProjects();
  const [query, setQuery] = useState("");
  const now = useNow();
  const entries = useMemo(() => {
    const { pinned, active, archived } = groupProjects(Object.values(state.byId), pinnedIds);
    return [...pinned, ...active, ...archived].filter((entry) =>
      matchesProjectSearch(entry, query),
    );
  }, [state.byId, pinnedIds, query]);
  const total = Object.keys(state.byId).length;
  const waiting = Object.values(state.byId).reduce(
    (sum, { threads }) => sum + attentionOf(threads).waiting,
    0,
  );

  return (
    <div data-testid="projects-index" className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-4 px-6 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold text-text">Projects</h1>
          {total > 0 ? (
            <p data-testid="projects-attention" className="mt-0.5 text-[13px] text-text-subtle">
              {attentionSentence(waiting)}
            </p>
          ) : null}
        </div>
        <Button size="sm" data-testid="projects-new" onClick={openNewProjectDialog}>
          <SquarePenIcon />
          New project
        </Button>
      </header>

      {state.phase === "error" ? (
        <p data-testid="projects-error" className="px-6 text-[13px] text-blocked">
          Could not load projects. {state.error}
        </p>
      ) : null}
      {state.phase === "loading" ? (
        <p className="px-6 text-[13px] text-text-subtle">Loading projects…</p>
      ) : null}
      {state.phase === "ready" && total === 0 ? <FirstProject /> : null}
      {total > 0 ? (
        <div className="flex flex-col gap-4 px-6 pb-6">
          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
            <Input
              data-testid="project-search"
              type="search"
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          {entries.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-text-subtle">
              No projects match “{query.trim()}”.
            </p>
          ) : (
            <div
              data-testid="project-grid"
              className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3"
            >
              {entries.map((entry) => (
                <ProjectCard key={entry.project.id} entry={entry} now={now} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

const FirstProject = () => (
  <div
    data-testid="projects-empty"
    className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-24 text-center"
  >
    <div className="flex flex-col gap-1.5">
      <h2 className="text-[15px] font-medium text-text">Start your first project</h2>
      <p className="max-w-md text-[13px] text-text-subtle">
        A project is one long-running conversation with a coordinator, which starts threads on your
        repositories and tells you when one needs you.
      </p>
    </div>
    <Button size="sm" data-testid="projects-empty-new" onClick={openNewProjectDialog}>
      <SquarePenIcon />
      New project
    </Button>
  </div>
);

const ProjectCard = ({ entry, now }: { entry: ProjectEntry; now: number }) => {
  const { project, threads, threadsLoaded } = entry;
  const attention = threadsLoaded ? attentionOf(threads) : null;

  return (
    <article
      data-testid="project-card"
      data-project-id={project.id}
      data-status={project.status}
      className={cn(
        "group/card relative flex min-h-[124px] flex-col gap-2 rounded-card border border-border bg-raised p-3.5 transition-colors duration-[120ms] hover:bg-hover",
        project.status === "archived" && "opacity-70",
      )}
    >
      <header className="flex items-center gap-2.5">
        <ProjectTile project={project} />
        <h2 className="min-w-0 flex-1 text-[14px] font-medium text-text">
          <Link
            to={projectPath(project.id)}
            data-testid="project-card-link"
            className="block truncate outline-none after:absolute after:inset-0 after:rounded-card after:content-['']"
          >
            {project.name}
          </Link>
        </h2>
        {project.status !== "active" ? (
          <span className="rounded-md border border-border-strong px-1.5 text-[11px] capitalize text-text-muted">
            {project.status}
          </span>
        ) : null}
        <span className="relative z-10 hidden group-hover/card:flex has-[[data-state=open]]:flex">
          <ProjectMenu project={project}>
            <button
              type="button"
              data-testid="project-card-menu"
              aria-label={`Actions for ${project.name}`}
              className="grid size-6 place-items-center rounded text-text-subtle hover:bg-active hover:text-text"
            >
              <EllipsisIcon className="size-3.5" />
            </button>
          </ProjectMenu>
        </span>
      </header>
      <p className="line-clamp-2 text-[12.5px] text-text-muted">{project.goal || "No goal set."}</p>
      <footer className="mt-auto flex items-center gap-3 pt-1 text-[11.5px] text-text-subtle">
        {attention ? <AttentionSummary attention={attention} /> : null}
        {project.repoIds.length > 0 ? (
          <span className="inline-flex items-center gap-1">
            <FolderGitIcon className="size-3" />
            {project.repoIds.length}
          </span>
        ) : null}
        <span className="flex-1" />
        <time
          dateTime={project.updatedAt}
          title={new Date(project.updatedAt).toLocaleString()}
          className="tabular-nums"
        >
          {formatAge(project.updatedAt, now)}
        </time>
      </footer>
    </article>
  );
};

const AttentionSummary = ({ attention }: { attention: Attention }) => {
  if (attention.waiting === 0 && attention.working === 0) return null;
  return (
    <span data-testid="project-card-attention" className="flex items-center gap-2">
      {attention.waiting > 0 ? (
        <span className="font-medium text-waiting">{attention.waiting} waiting on you</span>
      ) : null}
      {attention.working > 0 ? <span>{attention.working} working</span> : null}
    </span>
  );
};
