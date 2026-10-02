import {
  Maximize2Icon,
  Minimize2Icon,
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
import type { ProjectEntry } from "../projects-state";
import { RoutinesTab } from "../routines/RoutinesTab";
import { attentionOf, THREAD_STATUS_LABEL, THREAD_STATUS_ORDER } from "../selectors";
import { ThreadOverview } from "../ThreadOverview";
import { ThreadPane } from "../thread/ThreadPane";
import { PanelTabStrip } from "./PanelTabStrip";
import type { PanelTabId } from "./panel-tabs";
import { useOpenTabs } from "./use-open-tabs";
import type { OverviewFilters } from "./use-overview-filters";
import type { PanelLayout } from "./use-panel-layout";

/**
 * The right pane: the project's threads, and the other tabs the person opened. Its first view
 * is the threads' overview; a thread the address names replaces the tabs (with a breadcrumb
 * back), and the panel's own buttons (expand, close) move into that thread's header.
 */
export const ThreadsPanel = ({
  entry,
  threadId,
  tab,
  layout,
  filters,
  onNewThread,
}: {
  entry: ProjectEntry;
  threadId: string | null;
  /** The tab showing when no thread is open. */
  tab: PanelTabId;
  layout: PanelLayout;
  filters: OverviewFilters;
  onNewThread: () => void;
}) => {
  const { project, threads, threadsLoaded, threadsError } = entry;

  return (
    <div data-testid="threads-panel-content" className="flex min-h-0 flex-1 flex-col">
      {threadId === null ? (
        <PanelTabs
          entry={entry}
          tab={tab}
          layout={layout}
          filters={filters}
          onNewThread={onNewThread}
        />
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

const PanelTabs = ({
  entry,
  tab,
  layout,
  filters,
  onNewThread,
}: {
  entry: ProjectEntry;
  tab: PanelTabId;
  layout: PanelLayout;
  filters: OverviewFilters;
  onNewThread: () => void;
}) => {
  const openTabs = useOpenTabs(entry.project.id, tab);
  return (
    <>
      <PanelTabStrip
        projectId={entry.project.id}
        active={tab}
        openTabs={openTabs}
        waiting={attentionOf(entry.threads).waiting}
        onNewThread={onNewThread}
        actions={tab === "threads" ? <ThreadsActions filters={filters} /> : null}
        trailing={
          <>
            <ExpandButton layout={layout} />
            <CloseButton layout={layout} />
          </>
        }
      />
      <PanelTabBody entry={entry} tab={tab} filters={filters} />
    </>
  );
};

/** What a tab shows under the strip. Each tab owns its body, toolbar included. */
const PanelTabBody = ({
  entry,
  tab,
  filters,
}: {
  entry: ProjectEntry;
  tab: PanelTabId;
  filters: OverviewFilters;
}) => {
  switch (tab) {
    case "threads":
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ThreadOverview entry={entry} filters={filters} />
        </div>
      );
    case "routines":
      return <RoutinesTab project={entry.project} />;
  }
};

/** The Threads tab's own buttons on the strip: search and the status filter. */
const ThreadsActions = ({ filters }: { filters: OverviewFilters }) => (
  <>
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
  </>
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

/**
 * The frame the panel sits in, by layout mode: a pane, a sheet over the chat, or the whole screen.
 * Beside the chat it runs from the top of the screen (the project grid gives it its column and
 * width); covering the chat, it stays under the top bar.
 */
export const PanelFrame = ({ layout, children }: { layout: PanelLayout; children: ReactNode }) => {
  const sideBySide = layout.mode === "side";
  return (
    <aside
      data-testid="threads-panel"
      data-mode={layout.mode}
      data-expanded={layout.expanded}
      aria-label="Threads"
      style={layout.mode === "overlay" && !layout.expanded ? { width: layout.width } : undefined}
      className={cn(
        "flex min-h-0 min-w-0 flex-col border-l border-border bg-surface",
        layout.besideTopBar ? "row-span-full" : "row-start-2",
        sideBySide && (layout.expanded ? "col-span-full" : "col-start-3"),
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
