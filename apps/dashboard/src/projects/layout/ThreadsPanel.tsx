import {
  Maximize2Icon,
  MessagesSquareIcon,
  Minimize2Icon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { IconButton } from "../../components/IconButton";
import { Link, projectPath } from "../../shell/router";
import type { ProjectEntry } from "../projects-state";
import { attentionOf, THREAD_STATUS_LABEL, THREAD_STATUS_ORDER } from "../selectors";
import { ThreadOverview } from "../ThreadOverview";
import { ThreadPane } from "../thread/ThreadPane";
import type { OverviewFilters } from "./use-overview-filters";
import type { PanelLayout } from "./use-panel-layout";

// The panel's sections. Threads is the only one for now; a section added here gets a tab.
const PANEL_TABS = [{ id: "threads", label: "Threads", icon: MessagesSquareIcon }] as const;

/**
 * The right pane: the threads of the project. Its first view is the overview; a thread the
 * address names replaces it (with a breadcrumb back), and the panel's own buttons (expand,
 * close) move into that thread's header.
 */
export const ThreadsPanel = ({
  entry,
  threadId,
  layout,
  filters,
  onNewThread,
}: {
  entry: ProjectEntry;
  threadId: string | null;
  layout: PanelLayout;
  filters: OverviewFilters;
  onNewThread: () => void;
}) => {
  const { project, threads, threadsLoaded, threadsError } = entry;
  const controls = <PanelControls layout={layout} />;

  return (
    <div data-testid="threads-panel-content" className="flex min-h-0 flex-1 flex-col">
      {threadId === null ? (
        <>
          <PanelTabStrip
            entry={entry}
            layout={layout}
            filters={filters}
            onNewThread={onNewThread}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ThreadOverview entry={entry} filters={filters} onNewThread={onNewThread} />
          </div>
        </>
      ) : (
        <ThreadPane
          project={project}
          thread={threads.find((thread) => thread.id === threadId)}
          threads={threads}
          threadsLoaded={threadsLoaded}
          threadsError={threadsError}
          headerActions={controls}
        />
      )}
    </div>
  );
};

/** Expand (or restore) and close: the panel's buttons, wherever its header is. */
const PanelControls = ({ layout }: { layout: PanelLayout }) => (
  <>
    {layout.mode === "single" ? null : (
      <IconButton
        testId="panel-expand"
        label={layout.expanded ? "Restore panel" : "Expand panel"}
        pressed={layout.expanded}
        onClick={layout.toggleExpanded}
      >
        {layout.expanded ? <Minimize2Icon /> : <Maximize2Icon />}
      </IconButton>
    )}
    <IconButton testId="panel-close" label="Close panel" onClick={layout.close}>
      <XIcon />
    </IconButton>
  </>
);

const PanelTabStrip = ({
  entry,
  layout,
  filters,
  onNewThread,
}: {
  entry: ProjectEntry;
  layout: PanelLayout;
  filters: OverviewFilters;
  onNewThread: () => void;
}) => {
  const waiting = attentionOf(entry.threads).waiting;
  return (
    <div
      data-testid="panel-tabs"
      role="tablist"
      aria-label="Panel sections"
      className="flex h-12 shrink-0 items-center gap-1 px-3"
    >
      {PANEL_TABS.map(({ id, label, icon: Icon }) => (
        <Link
          key={id}
          to={projectPath(entry.project.id)}
          role="tab"
          aria-selected
          data-testid={`panel-tab-${id}`}
          className="flex h-8 items-center gap-2 rounded-row bg-active px-3 text-[13.5px] font-medium text-text"
        >
          <Icon aria-hidden="true" className="size-4 text-text-muted" />
          {label}
          {waiting > 0 && id === "threads" ? (
            <span
              data-testid="project-tab-waiting"
              className="rounded-full bg-running px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground"
            >
              {waiting}
            </span>
          ) : null}
        </Link>
      ))}
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border-strong" />
      <IconButton testId="panel-new-thread" label="New thread" onClick={onNewThread}>
        <PlusIcon />
      </IconButton>
      <span className="flex-1" />
      <IconButton
        testId="panel-search"
        label="Search threads"
        pressed={filters.searchOpen}
        active={filters.searchOpen}
        onClick={filters.toggleSearch}
      >
        <SearchIcon />
      </IconButton>
      <StatusFilter filters={filters} />
      <PanelControls layout={layout} />
    </div>
  );
};

const StatusFilter = ({ filters }: { filters: OverviewFilters }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <IconButton
        testId="panel-filter"
        label="Filter threads"
        active={filters.hidden.size > 0}
        dot={filters.hidden.size > 0}
        dotTestId="panel-filter-dot"
      >
        <SlidersHorizontalIcon />
      </IconButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" data-testid="panel-filter-menu" className="w-52">
      <DropdownMenuLabel>Show threads</DropdownMenuLabel>
      {THREAD_STATUS_ORDER.map((status) => (
        <DropdownMenuCheckboxItem
          key={status}
          data-testid="panel-filter-option"
          data-status={status}
          checked={!filters.hidden.has(status)}
          onCheckedChange={() => filters.toggleStatus(status)}
          onSelect={(event) => event.preventDefault()}
        >
          {THREAD_STATUS_LABEL[status]}
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

/** The frame the panel sits in, by layout mode: a pane, a sheet over the chat, or the whole screen. */
export const PanelFrame = ({ layout, children }: { layout: PanelLayout; children: ReactNode }) => {
  const sideBySide = layout.mode === "side";
  return (
    <aside
      data-testid="threads-panel"
      data-mode={layout.mode}
      data-expanded={layout.expanded}
      aria-label="Threads"
      style={layout.expanded || layout.mode === "single" ? undefined : { width: layout.width }}
      className={cn(
        "flex min-h-0 min-w-0 flex-col border-l border-border bg-surface",
        sideBySide && !layout.expanded && "max-w-[calc(100%-340px)] shrink-0",
        sideBySide && layout.expanded && "flex-1",
        layout.mode === "overlay" &&
          "absolute inset-y-0 right-0 z-20 shadow-[-12px_0_32px_rgb(0_0_0/0.4)]",
        layout.mode === "overlay" && (layout.expanded ? "w-full" : "max-w-full"),
        layout.mode === "single" && "absolute inset-0 border-l-0",
      )}
    >
      {children}
    </aside>
  );
};
