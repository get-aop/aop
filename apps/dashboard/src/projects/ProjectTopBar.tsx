import { EllipsisIcon, ListChecksIcon, SettingsIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { iconButtonClass } from "../components/IconButton";
import { Link, projectPath, projectSettingsPath } from "../shell/router";
import { ShellNav } from "../shell/ShellNav";
import { ProjectMenu } from "./ProjectMenu";
import { ProjectTile } from "./ProjectTile";
import type { ProjectEntry, StreamConnection } from "./projects-state";
import { attentionOf } from "./selectors";

const STREAM_LABEL: Record<StreamConnection, string | null> = {
  idle: null,
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

type Panel = { visible: boolean; toggle: () => void };

/**
 * The top of a project's screens: the sidebar toggle and back/forward, who the project is,
 * then right beside the name its controls as one group: the labelled Overview toggle for the
 * threads panel (with a dot when a thread waits on the person), the project's settings and its
 * menu (the gear is marked while the settings dialog is open). The stream's state comes last.
 */
export const ProjectTopBar = ({
  entry,
  panel,
  settingsOpen,
}: {
  entry: ProjectEntry;
  panel: Panel;
  settingsOpen: boolean;
}) => {
  const { project, threads, connection } = entry;
  const waiting = attentionOf(threads).waiting > 0;
  const streamLabel = STREAM_LABEL[connection];

  return (
    <header
      data-testid="project-topbar"
      className="flex h-pane-header shrink-0 items-center gap-2 border-b border-border px-2"
    >
      <ShellNav />
      <Link
        to={projectPath(project.id)}
        data-testid="project-home-link"
        className="flex min-w-0 items-center gap-2 rounded-row px-1.5 py-1 hover:bg-hover"
      >
        <ProjectTile project={project} />
        <h1 data-testid="project-title" className="truncate text-title font-semibold text-text">
          {project.name}
        </h1>
      </Link>
      {project.status !== "active" ? (
        <span
          data-testid="project-status-tag"
          className="shrink-0 rounded-md border border-border-strong px-1.5 text-xs font-medium capitalize text-text-muted"
        >
          {project.status}
        </span>
      ) : null}
      <div data-testid="project-topbar-actions" className="flex shrink-0 items-center gap-0.5">
        <OverviewToggle panel={panel} waiting={waiting} />
        <Link
          to={projectSettingsPath(project.id)}
          data-testid="project-settings-link"
          aria-label="Project settings"
          title="Project settings"
          aria-current={settingsOpen ? "page" : undefined}
          className={iconButtonClass(settingsOpen)}
        >
          <SettingsIcon />
        </Link>
        <ProjectMenu project={project}>
          <button
            type="button"
            data-testid="project-header-menu"
            aria-label="Project actions"
            className={iconButtonClass()}
          >
            <EllipsisIcon />
          </button>
        </ProjectMenu>
      </div>
      {streamLabel ? (
        <span
          data-testid="project-stream-state"
          data-state={connection}
          className="hidden shrink-0 items-center gap-1.5 text-meta text-text-subtle lg:flex"
        >
          <span
            className={cn("size-1.5 rounded-full", connection === "live" ? "bg-ok" : "bg-waiting")}
          />
          {streamLabel}
        </span>
      ) : null}
    </header>
  );
};

/** The threads panel's toggle, labelled "Overview" after the panel's first screen. */
const OverviewToggle = ({ panel, waiting }: { panel: Panel; waiting: boolean }) => (
  <button
    type="button"
    data-testid="panel-toggle"
    aria-pressed={panel.visible}
    title={panel.visible ? "Hide the overview" : "Show the overview"}
    onClick={panel.toggle}
    className={cn(
      "relative flex h-8 shrink-0 items-center gap-1.5 rounded-row pr-3 pl-2 text-meta font-medium text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text [&_svg]:size-4",
      panel.visible && "bg-active text-text",
    )}
  >
    <ListChecksIcon aria-hidden="true" />
    Overview
    {waiting ? (
      <span
        data-testid="panel-toggle-dot"
        aria-hidden="true"
        className="absolute top-1 right-1 size-1.5 rounded-full bg-running"
      />
    ) : null}
  </button>
);
