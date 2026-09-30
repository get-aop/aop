import { EllipsisIcon, PanelRightIcon, SettingsIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, iconButtonClass } from "../components/IconButton";
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

/**
 * The top of a project's screens: the sidebar toggle and back/forward, who the project is,
 * then the panel toggle right beside the name (with a dot when a thread waits on the person),
 * the stream's state, and at the far end the project's settings and its menu. Settings has no panel, so no toggle.
 */
export const ProjectTopBar = ({
  entry,
  panel,
  settingsOpen,
}: {
  entry: ProjectEntry;
  panel: { visible: boolean; toggle: () => void } | null;
  settingsOpen: boolean;
}) => {
  const { project, threads, connection } = entry;
  const waiting = attentionOf(threads).waiting;
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
      {panel ? (
        <IconButton
          testId="panel-toggle"
          label={panel.visible ? "Hide threads panel" : "Show threads panel"}
          pressed={panel.visible}
          active={panel.visible}
          dot={waiting > 0}
          dotTestId="panel-toggle-dot"
          onClick={panel.toggle}
        >
          <PanelRightIcon />
        </IconButton>
      ) : null}
      {project.status !== "active" ? (
        <span
          data-testid="project-status-tag"
          className="shrink-0 rounded-md border border-border-strong px-1.5 text-xs font-medium capitalize text-text-muted"
        >
          {project.status}
        </span>
      ) : null}
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
      <span className="flex-1" />
      <span className="flex-1" />
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
    </header>
  );
};
