import { EllipsisIcon, GlobeIcon, ListChecksIcon, SettingsIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, iconButtonClass } from "../components/IconButton";
import { Link, projectSettingsPath } from "../shell/router";
import { ShellNav } from "../shell/ShellNav";
import { ShellStatus } from "../shell/ShellStatus";
import { ProjectMenu } from "./ProjectMenu";
import type { ProjectEntry, StreamConnection } from "./projects-state";
import { attentionOf } from "./selectors";

const STREAM_LABEL: Record<StreamConnection, string | null> = {
  idle: null,
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

type Panel = { visible: boolean; toggle: () => void };
/** The AOP Browser's button, in the desktop app only. */
type Browser = { shown: boolean; toggle: () => void };

/**
 * The top of a project's screens: back/forward, the project switcher naming the project and the
 * new-project button, then the project's controls as one group: the labelled Overview toggle for
 * the threads panel (with a dot when a thread waits on the person), the AOP Browser (in the
 * desktop app), the project's settings and its menu (the gear is marked while the settings dialog
 * is open), then the stream's state. The far end holds host-wide status (ShellStatus).
 */
export const ProjectTopBar = ({
  entry,
  panel,
  browser,
  settingsOpen,
  className,
}: {
  entry: ProjectEntry;
  panel: Panel;
  browser?: Browser;
  settingsOpen: boolean;
  /** Where the project grid puts it: over the chat only, or across the screen. */
  className?: string;
}) => {
  const { project, threads, connection } = entry;
  const waiting = attentionOf(threads).waiting > 0;
  const streamLabel = STREAM_LABEL[connection];

  return (
    // Its bottom line is a shadow, not a border, so the row's content centres on the same line as
    // the panel header beside it. As a container it drops its labels when the chat is narrow.
    <header
      data-testid="project-topbar"
      className={cn(
        "@container flex h-pane-header min-w-0 shrink-0 items-center gap-1 px-2 @md:gap-2 shadow-[inset_0_-1px_0_var(--color-border)]",
        className,
      )}
    >
      <ShellNav current={entry} />
      <div data-testid="project-topbar-actions" className="flex shrink-0 items-center gap-0.5">
        <OverviewToggle panel={panel} waiting={waiting} />
        {browser ? (
          <IconButton
            testId="browser-toggle"
            label={browser.shown ? "Back to the coordinator (⌘⇧B)" : "AOP Browser (⌘⇧B)"}
            aria-keyshortcuts="Meta+Shift+B"
            pressed={browser.shown}
            active={browser.shown}
            onClick={browser.toggle}
          >
            <GlobeIcon />
          </IconButton>
        ) : null}
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
          className="hidden shrink-0 items-center gap-1.5 text-meta text-text-subtle @xl:flex"
        >
          <span
            className={cn("size-1.5 rounded-full", connection === "live" ? "bg-ok" : "bg-waiting")}
          />
          {streamLabel}
        </span>
      ) : null}
      <ShellStatus testId="project-topbar-status" />
    </header>
  );
};

/**
 * The threads panel's toggle, labelled "Overview" after the panel's first screen. A narrow bar
 * shows only its icon (the title still names it).
 */
const OverviewToggle = ({ panel, waiting }: { panel: Panel; waiting: boolean }) => (
  <button
    type="button"
    data-testid="panel-toggle"
    aria-pressed={panel.visible}
    title={panel.visible ? "Hide the overview" : "Show the overview"}
    onClick={panel.toggle}
    className={cn(
      "relative flex h-8 shrink-0 items-center gap-1.5 rounded-row px-2 text-meta font-medium text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text [&_svg]:size-4",
      panel.visible && "bg-active text-text",
    )}
  >
    <ListChecksIcon aria-hidden="true" />
    <span className="hidden pr-1 @sm:inline">Overview</span>
    {waiting ? (
      <span
        data-testid="panel-toggle-dot"
        aria-hidden="true"
        className="absolute top-1 right-1 size-1.5 rounded-full bg-running"
      />
    ) : null}
  </button>
);
