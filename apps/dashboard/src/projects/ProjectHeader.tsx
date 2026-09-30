import { EllipsisIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  coordinatorPath,
  Link,
  projectPath,
  projectSettingsPath,
  type Route,
} from "../shell/router";
import { ProjectMenu } from "./ProjectMenu";
import { ProjectTile } from "./ProjectTile";
import type { ProjectEntry, StreamConnection } from "./projects-state";
import { attentionOf, attentionSentence } from "./selectors";

type ProjectRoute = Exclude<Route, { name: "projects" }>;

const STREAM_LABEL: Record<StreamConnection, string | null> = {
  idle: null,
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

/**
 * What every screen of a project shares: who it is, what is waiting on the person, whether
 * its stream is live, and the tabs between its screens. The screen itself renders below it.
 */
export const ProjectHeader = ({ entry, route }: { entry: ProjectEntry; route: ProjectRoute }) => {
  const { project, threads, threadsLoaded, connection } = entry;
  const attention = attentionOf(threads);
  const streamLabel = STREAM_LABEL[connection];

  return (
    <header data-testid="project-header" className="shrink-0 border-b border-border px-6 pt-5">
      <div className="flex items-start gap-3">
        <ProjectTile project={project} className="mt-0.5 size-9 text-[15px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1
              data-testid="project-title"
              className="truncate text-[18px] font-semibold text-text"
            >
              {project.name}
            </h1>
            {project.status !== "active" ? (
              <span
                data-testid="project-status-tag"
                className="rounded-md border border-border-strong px-1.5 text-[11px] font-medium capitalize text-text-muted"
              >
                {project.status}
              </span>
            ) : null}
          </div>
          {project.goal ? (
            <p className="mt-0.5 line-clamp-2 max-w-3xl text-[13px] text-text-muted">
              {project.goal}
            </p>
          ) : null}
          {threadsLoaded ? (
            <p
              data-testid="project-attention"
              data-waiting={attention.waiting}
              className={cn(
                "mt-1 text-[12.5px]",
                attention.waiting > 0 ? "text-waiting" : "text-text-subtle",
              )}
            >
              {attentionSentence(attention.waiting)}
            </p>
          ) : null}
        </div>
        {streamLabel ? (
          <span
            data-testid="project-stream-state"
            data-state={connection}
            className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-text-subtle"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                connection === "live" ? "bg-ok" : "bg-waiting",
              )}
            />
            {streamLabel}
          </span>
        ) : null}
        <ProjectMenu project={project}>
          <button
            type="button"
            data-testid="project-header-menu"
            aria-label="Project actions"
            className="grid size-8 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
          >
            <EllipsisIcon className="size-4" />
          </button>
        </ProjectMenu>
      </div>

      <nav aria-label="Project" className="mt-3 flex items-end gap-5">
        <Tab
          to={projectPath(project.id)}
          testId="project-tab-threads"
          active={route.name === "project" || route.name === "thread"}
        >
          Threads
          {attention.waiting > 0 ? (
            <span
              data-testid="project-tab-waiting"
              className="ml-1.5 rounded-md bg-waiting/15 px-1.5 text-[11px] font-semibold tabular-nums text-waiting"
            >
              {attention.waiting}
            </span>
          ) : null}
        </Tab>
        <Tab
          to={coordinatorPath(project.id)}
          testId="project-tab-coordinator"
          active={route.name === "coordinator"}
        >
          Coordinator
        </Tab>
        <span className="flex-1" />
        <Tab
          to={projectSettingsPath(project.id)}
          testId="project-tab-settings"
          active={route.name === "project-settings"}
        >
          Settings
        </Tab>
      </nav>
    </header>
  );
};

const Tab = ({
  to,
  testId,
  active,
  children,
}: {
  to: string;
  testId: string;
  active: boolean;
  children: React.ReactNode;
}) => (
  <Link
    to={to}
    data-testid={testId}
    aria-current={active ? "page" : undefined}
    className={cn(
      "-mb-px flex h-9 items-center border-b-2 text-[13px] font-medium transition-colors duration-[120ms]",
      active ? "border-text text-text" : "border-transparent text-text-muted hover:text-text",
    )}
  >
    {children}
  </Link>
);
