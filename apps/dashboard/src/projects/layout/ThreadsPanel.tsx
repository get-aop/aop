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
export const PANEL_TABS = [{ id: "threads", label: "Threads", icon: MessagesSquareIcon }] as const;
const ACTIVE_TAB: (typeof PANEL_TABS)[number]["id"] = "threads";

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
            <ThreadOverview entry={entry} filters={filters} />
          </div>
        </>
      ) : (
        <ThreadPane
          project={project}
          thread={threads.find((thread) => thread.id === threadId)}
          threads={threads}
          threadsLoaded={threadsLoaded}
          threadsError={threadsError}
          headerActions={<ExpandButton layout={layout} />}
          headerClose={<CloseButton layout={layout} />}
        />
      )}
    </div>
  );
};

/** Expand (or restore): the panel's button, wherever its header is. A phone's panel is the whole screen already. */
const ExpandButton = ({ layout }: { layout: PanelLayout }) =>
  layout.mode === "single" ? null : (
    <IconButton
      testId="panel-expand"
      label={layout.expanded ? "Restore panel" : "Expand panel"}
      pressed={layout.expanded}
      onClick={layout.toggleExpanded}
    >
      {layout.expanded ? <Minimize2Icon /> : <Maximize2Icon />}
    </IconButton>
  );

const CloseButton = ({ layout }: { layout: PanelLayout }) => (
  <IconButton testId="panel-close" label="Close panel" onClick={layout.close}>
    <XIcon />
  </IconButton>
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
      className="flex h-pane-header shrink-0 items-center gap-1 px-3"
    >
      {PANEL_TABS.map((tab) => (
        <PanelTab
          key={tab.id}
          tab={tab}
          active={tab.id === ACTIVE_TAB}
          projectId={entry.project.id}
          waiting={tab.id === "threads" ? waiting : 0}
        />
      ))}
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
      <ExpandButton layout={layout} />
      <CloseButton layout={layout} />
    </div>
  );
};

/**
 * One section of the panel: the one showing has its icon and name, the others only their icon
 * (the name is in the tooltip), so the strip stays short.
 */
export const PanelTab = ({
  tab: { id, label, icon: Icon },
  active,
  projectId,
  waiting,
}: {
  tab: (typeof PANEL_TABS)[number];
  active: boolean;
  projectId: string;
  /** Threads waiting on the person, counted on the tab. */
  waiting: number;
}) => (
  <Link
    to={projectPath(projectId)}
    role="tab"
    aria-selected={active}
    aria-label={active ? undefined : label}
    title={active ? undefined : label}
    data-testid={`panel-tab-${id}`}
    className={cn(
      "flex h-8 items-center gap-2 rounded-row text-body transition-colors duration-[120ms]",
      active
        ? "border border-border-strong bg-active px-2.5 font-medium text-text"
        : "w-8 justify-center text-text-subtle hover:bg-hover hover:text-text",
    )}
  >
    <Icon aria-hidden="true" className={cn("size-4", active && "text-text-muted")} />
    {active ? label : null}
    {waiting > 0 ? (
      <span
        data-testid="project-tab-waiting"
        className="rounded-full bg-running px-1.5 text-xs font-semibold tabular-nums text-primary-foreground"
      >
        {waiting}
      </span>
    ) : null}
  </Link>
);

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
