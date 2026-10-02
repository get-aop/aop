import { ChevronRightIcon, GlobeIcon, MessageSquareIcon, PlusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/ui/spinner";
import { IconButton } from "../../components/IconButton";
import { pageLabel } from "./address";
import { closeBrowserView } from "./open-browser-view";
import type { BrowserTab } from "./tabs";

/** What the header shows of a tab besides its saved title: its icon, loading, a waiting question. */
export interface TabBadge {
  favicon?: string;
  loading: boolean;
  asking: boolean;
}

/**
 * The browser's top row: the breadcrumb back to the coordinator (as the pull request view has),
 * then the tabs, a new-tab button and ×.
 */
export const BrowserHeader = ({
  tabs,
  activeId,
  badges,
  onActivate,
  onClose,
  onNewTab,
}: {
  tabs: readonly BrowserTab[];
  activeId: string;
  badges: Readonly<Record<string, TabBadge>>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
}) => (
  <nav
    aria-label="Breadcrumb"
    className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2 text-meta"
  >
    <button
      type="button"
      data-testid="browser-pane-coordinator"
      onClick={closeBrowserView}
      className="flex shrink-0 items-center gap-1.5 rounded-row px-2 py-1 text-text-subtle hover:bg-hover hover:text-text"
    >
      <MessageSquareIcon className="size-3.5" aria-hidden="true" />
      Coordinator
    </button>
    <ChevronRightIcon className="size-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
    <span aria-current="page" className="shrink-0 px-1 font-medium text-text">
      Browser
    </span>
    <div
      role="tablist"
      aria-label="Browser tabs"
      data-testid="browser-tabs"
      className="ml-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto border-l border-border pl-1.5 [scrollbar-width:none]"
    >
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          badge={badges[tab.id]}
          onActivate={onActivate}
          onClose={onClose}
        />
      ))}
      <IconButton testId="browser-new-tab" label="New tab (⌘T)" onClick={onNewTab}>
        <PlusIcon />
      </IconButton>
    </div>
    <IconButton
      testId="browser-pane-close"
      label="Close the browser (⌘⇧B)"
      aria-keyshortcuts="Meta+Shift+B"
      onClick={closeBrowserView}
    >
      <XIcon />
    </IconButton>
  </nav>
);

const TabButton = ({
  tab,
  active,
  badge,
  onActivate,
  onClose,
}: {
  tab: BrowserTab;
  active: boolean;
  badge: TabBadge | undefined;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) => {
  const label = pageLabel(tab.url, tab.title);
  return (
    <div
      className={cn(
        "group flex h-7 min-w-[72px] max-w-[180px] flex-1 basis-0 items-center rounded-row pr-0.5 text-text-subtle hover:bg-hover hover:text-text",
        active && "bg-active text-text",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        data-testid="browser-tab"
        data-active={active}
        title={tab.url ?? label}
        onClick={() => onActivate(tab.id)}
        // A middle click closes a tab, as in every browser.
        onAuxClick={(event) => {
          if (event.button === 1) onClose(tab.id);
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch pl-2 text-left outline-none"
      >
        <TabIcon badge={badge} />
        <span className="truncate">{label}</span>
        {badge?.asking ? (
          <>
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-waiting" />
            <span className="sr-only">(asking for permission)</span>
          </>
        ) : null}
      </button>
      <button
        type="button"
        data-testid="browser-tab-close"
        aria-label={`Close ${label}`}
        title="Close tab (⌘W)"
        onClick={() => onClose(tab.id)}
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-sm text-text-subtle hover:bg-active hover:text-text",
          !active && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <XIcon className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
};

const TabIcon = ({ badge }: { badge: TabBadge | undefined }) => {
  if (badge?.loading) return <Spinner className="size-3.5" />;
  if (badge?.favicon) {
    return <img src={badge.favicon} alt="" className="size-3.5 shrink-0 rounded-[2px]" />;
  }
  return <GlobeIcon className="size-3.5 shrink-0" aria-hidden="true" />;
};
