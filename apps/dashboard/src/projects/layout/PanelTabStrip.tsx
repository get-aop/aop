import { MessageSquarePlusIcon, PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { IconButton } from "../../components/IconButton";
import { Link, projectPath, projectTabPath } from "../../shell/router";
import {
  ADDABLE_TAB_IDS,
  type AddableTabId,
  type PanelTabId,
  type PanelTabSpec,
  panelTabSpec,
} from "./panel-tabs";
import type { OpenTabs } from "./use-open-tabs";

/**
 * The panel's header on its tabs: the open tabs, then "+" (a new thread, or another tab), then
 * what the showing tab puts on the right (`actions`) and the panel's own buttons (`trailing`).
 */
export const PanelTabStrip = ({
  projectId,
  active,
  openTabs,
  waiting,
  onNewThread,
  actions,
  trailing,
}: {
  projectId: string;
  active: PanelTabId;
  openTabs: OpenTabs;
  /** Threads waiting on the person, counted on the Threads tab. */
  waiting: number;
  onNewThread: () => void;
  actions?: ReactNode;
  trailing: ReactNode;
}) => (
  <div
    data-testid="panel-tabs"
    role="tablist"
    aria-label="Panel sections"
    className="flex h-pane-header shrink-0 items-center gap-1 px-3"
  >
    {openTabs.tabs.map((id) => (
      <PanelTab
        key={id}
        tab={panelTabSpec(id)}
        active={id === active}
        projectId={projectId}
        waiting={id === "threads" ? waiting : 0}
        onClose={id === "threads" ? undefined : () => openTabs.closeTab(id)}
      />
    ))}
    <AddMenu openTabs={openTabs} onNewThread={onNewThread} />
    <span className="flex-1" />
    {actions}
    {trailing}
  </div>
);

/**
 * One section of the panel: the one showing has its icon and name (and a close button, but
 * for Threads), the others only their icon (the name is in the tooltip), so the strip stays short.
 */
export const PanelTab = ({
  tab: { id, label, icon: Icon },
  active,
  projectId,
  waiting,
  onClose,
}: {
  tab: PanelTabSpec;
  active: boolean;
  projectId: string;
  /** Threads waiting on the person, counted on the tab. */
  waiting: number;
  /** Takes the tab off the strip; Threads has none. */
  onClose?: () => void;
}) => {
  const closable = active && onClose !== undefined;
  return (
    <span
      className={cn(
        "flex h-8 shrink-0 items-center rounded-row transition-colors duration-[120ms]",
        active && "border border-border-strong bg-active",
      )}
    >
      <Link
        to={id === "threads" ? projectPath(projectId) : projectTabPath(projectId, id)}
        role="tab"
        aria-selected={active}
        aria-label={active ? undefined : label}
        title={active ? undefined : label}
        data-testid={`panel-tab-${id}`}
        className={tabLinkClass(active, closable)}
      >
        <Icon aria-hidden="true" className={cn("size-4", active && "text-text-muted")} />
        {active ? <span className="truncate">{label}</span> : null}
        {waiting > 0 ? <WaitingCount waiting={waiting} /> : null}
      </Link>
      {closable ? <CloseTabButton id={id} label={label} onClose={onClose} /> : null}
    </span>
  );
};

const tabLinkClass = (active: boolean, closable: boolean): string =>
  cn(
    "flex h-full items-center gap-2 rounded-row text-body",
    active
      ? cn("font-medium text-text", closable ? "pr-1 pl-2.5" : "px-2.5")
      : "w-8 justify-center text-text-subtle hover:bg-hover hover:text-text",
  );

const WaitingCount = ({ waiting }: { waiting: number }) => (
  <span
    data-testid="project-tab-waiting"
    className="rounded-full bg-running px-1.5 text-xs font-semibold tabular-nums text-primary-foreground"
  >
    {waiting}
  </span>
);

const CloseTabButton = ({
  id,
  label,
  onClose,
}: {
  id: PanelTabId;
  label: string;
  onClose?: () => void;
}) => (
  <button
    type="button"
    data-testid={`panel-tab-close-${id}`}
    aria-label={`Close ${label}`}
    title={`Close ${label}`}
    onClick={onClose}
    className="mr-1 grid size-5 place-items-center rounded-sm text-text-subtle hover:bg-hover hover:text-text [&_svg]:size-3.5"
  >
    <XIcon aria-hidden="true" />
  </button>
);

/** "+": a new thread, and the tabs the panel can show, ticked while open. */
const AddMenu = ({ openTabs, onNewThread }: { openTabs: OpenTabs; onNewThread: () => void }) => {
  // A new thread starts in the coordinator's composer: the menu must not take focus back to "+".
  const toComposer = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton testId="panel-add" label="New thread or tab">
          <PlusIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-testid="panel-add-menu"
        className="w-52"
        onCloseAutoFocus={(event) => {
          if (toComposer.current) event.preventDefault();
          toComposer.current = false;
        }}
      >
        <DropdownMenuItem
          data-testid="panel-new-thread"
          onSelect={() => {
            toComposer.current = true;
            onNewThread();
          }}
        >
          <MessageSquarePlusIcon aria-hidden="true" />
          New thread
        </DropdownMenuItem>
        {ADDABLE_TAB_IDS.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Tabs</DropdownMenuLabel>
            {ADDABLE_TAB_IDS.map((id) => (
              <AddTabItem key={id} id={id} openTabs={openTabs} />
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const AddTabItem = ({ id, openTabs }: { id: AddableTabId; openTabs: OpenTabs }) => {
  const { label, icon: Icon } = panelTabSpec(id);
  return (
    <DropdownMenuCheckboxItem
      data-testid={`panel-add-tab-${id}`}
      checked={openTabs.tabs.includes(id)}
      onCheckedChange={(checked) => (checked ? openTabs.openTab(id) : openTabs.closeTab(id))}
    >
      <Icon aria-hidden="true" />
      {label}
    </DropdownMenuCheckboxItem>
  );
};
