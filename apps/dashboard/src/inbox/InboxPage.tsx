import { INBOX_VIEWS, type InboxItem, type InboxRules, type InboxView } from "@aop/common";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { getInboxRules, getInboxSources } from "../api/inbox";
import { useProjectsState } from "../projects/ProjectsProvider";
import { openSettingsDialog } from "../shell/dialog-store";
import { inboxPath, navigate } from "../shell/router";
import { ShellNav } from "../shell/ShellNav";
import { ShellStatus } from "../shell/ShellStatus";
import { ChoiceSelect } from "./ChoiceSelect";
import { InboxItemView, type ItemViewHandle } from "./InboxItemView";
import { InboxList } from "./InboxList";
import { VIEW_LABEL } from "./inbox-format";
import { useInboxSummary } from "./inbox-summary-store";
import { type InboxState, useInbox } from "./use-inbox";

/**
 * `/inbox`: the person's Slack activity that needs them. The views on top, the list on the left
 * and the open item on the right; on a narrow screen the list and the item take turns. Keys: J/K
 * move, E done, R reply, D dispatch, O open in Slack.
 */
export const InboxPage = ({ itemId }: { itemId: string | null }) => {
  const inbox = useInbox(itemId);
  const view = useRef<ItemViewHandle>(null);
  const me = useSlackName();
  useInboxKeys(inbox, itemId, view);

  const afterDone = (item: InboxItem) => {
    inbox.changed(item);
    navigate(inboxPath(nextAfter(inbox.items, item.id)), { replace: true });
  };

  return (
    <div data-testid="inbox-page" className="flex h-full min-h-0 flex-col">
      <header
        data-testid="inbox-topbar"
        className="@container flex h-pane-header min-w-0 shrink-0 items-center gap-1 px-2 @md:gap-2 shadow-[inset_0_-1px_0_var(--color-border)]"
      >
        <ShellNav current={null} />
        <h1 className="ml-1 truncate text-[15px] font-semibold text-text">Inbox</h1>
        <ShellStatus testId="inbox-topbar-status" />
      </header>
      <Toolbar inbox={inbox} />
      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Inbox items"
          className={cn(
            "min-h-0 w-full overflow-y-auto border-border md:w-[380px] md:shrink-0 md:border-r",
            itemId && "hidden md:block",
          )}
        >
          <ListBody inbox={inbox} itemId={itemId} />
        </section>
        <section
          aria-label="Inbox item"
          className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", !itemId && "hidden md:block")}
        >
          {inbox.selected ? (
            <InboxItemView
              ref={view}
              item={inbox.selected}
              me={me}
              projectFilter={inbox.projectId}
              onChanged={inbox.changed}
              onDone={afterDone}
            />
          ) : (
            <p className="p-6 text-[13px] text-text-subtle">
              {itemId
                ? "Reading the item…"
                : "Pick an item to read it, reply or dispatch a thread."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
};

const Toolbar = ({ inbox }: { inbox: InboxState }) => {
  const summary = useInboxSummary();
  const mapped = useMappedProjects();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2">
      <div role="tablist" aria-label="Views" className="flex flex-wrap gap-0.5">
        {INBOX_VIEWS.map((name: InboxView) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={inbox.view === name}
            data-testid={`inbox-view-${name}`}
            onClick={() => inbox.setView(name)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-row px-2 text-[12.5px] transition-colors duration-[120ms]",
              inbox.view === name
                ? "bg-active text-text"
                : "text-text-muted hover:bg-hover hover:text-text",
            )}
          >
            {VIEW_LABEL[name]}
            {name === "needs-me" && summary && summary.unread > 0 ? (
              <span className="text-[11px] text-text-subtle">{summary.unread}</span>
            ) : null}
          </button>
        ))}
      </div>
      {mapped.length > 0 ? (
        <ChoiceSelect
          testId="inbox-project-filter"
          label="Project"
          value={inbox.projectId}
          none="Any project"
          options={mapped}
          onChange={inbox.setProjectId}
          className="w-40"
        />
      ) : null}
      <FeedStatus />
    </div>
  );
};

/** How the Slack feed is doing; anything but live says what to do. */
const FeedStatus = () => {
  const summary = useInboxSummary();
  if (!summary?.connected) return null;
  const health = summary.health ?? "connecting";
  const text = FEED_TEXT[health];
  return (
    <button
      type="button"
      data-testid="inbox-feed-status"
      data-health={health}
      onClick={() => openSettingsDialog("connections")}
      title="Slack connection settings"
      className={cn(
        "ml-auto flex items-center gap-1.5 text-[12px] hover:underline",
        health === "live"
          ? "text-text-subtle"
          : health === "revoked"
            ? "text-blocked"
            : "text-waiting",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          health === "live" ? "bg-ok" : health === "revoked" ? "bg-blocked" : "bg-waiting",
        )}
      />
      {text}
    </button>
  );
};

const FEED_TEXT = {
  live: "Live · Slack",
  connecting: "Connecting to Slack…",
  offline: "Reconnecting to Slack…",
  "no-events": "Connected, but Slack sends no events: how to fix",
  revoked: "Slack refused the token: reconnect",
} as const;

const ListBody = ({ inbox, itemId }: { inbox: InboxState; itemId: string | null }) => {
  const summary = useInboxSummary();
  if (summary && !summary.connected && inbox.items?.length === 0) return <NotConnected />;
  if (inbox.error) {
    return (
      <p data-testid="inbox-error" className="p-4 text-[13px] text-blocked">
        Could not read the Inbox. {inbox.error}
      </p>
    );
  }
  if (inbox.items === null) return <p className="p-4 text-[13px] text-text-subtle">Loading…</p>;
  if (inbox.items.length === 0) {
    return (
      <p data-testid="inbox-empty" className="p-4 text-[13px] text-text-subtle">
        {inbox.view === "needs-me" ? "Nothing needs you. " : "Nothing here. "}
        {inbox.view === "done" ? "" : "New mentions, DMs and replies in your threads show up here."}
      </p>
    );
  }
  return (
    <InboxList
      items={inbox.items}
      selectedId={itemId}
      hasMore={inbox.hasMore}
      onLoadMore={inbox.loadMore}
    />
  );
};

const NotConnected = () => (
  <div data-testid="inbox-not-connected" className="flex flex-col items-start gap-2 p-4">
    <p className="text-[13px] text-text">Connect Slack to fill your Inbox.</p>
    <p className="text-[12.5px] text-text-subtle">
      AOP reads your Slack through a small app that only you install, in your own workspace.
    </p>
    <Button size="sm" onClick={() => openSettingsDialog("connections")}>
      Connect Slack
    </Button>
  </div>
);

/** The projects some channel is mapped to, for the filter. */
const useMappedProjects = () => {
  const [rules, setRules] = useState<InboxRules | null>(null);
  const projects = useProjectsState().byId;
  useEffect(() => {
    void getInboxRules().then(setRules, () => undefined);
  }, []);
  const ids = new Set(
    Object.values(rules?.channels ?? {})
      .map((rule) => rule.projectId)
      .filter((id): id is string => Boolean(id)),
  );
  return [...ids].map((id) => ({ value: id, label: projects[id]?.project.name ?? id }));
};

const useSlackName = (): string => {
  const [name, setName] = useState("you");
  useEffect(() => {
    void getInboxSources().then(
      (sources) => setName(sources.slack?.userName ?? "you"),
      () => undefined,
    );
  }, []);
  return name;
};

const nextAfter = (items: InboxItem[] | null, id: string): string | null => {
  if (!items) return null;
  const at = items.findIndex((item) => item.id === id);
  return items[at + 1]?.id ?? items[at - 1]?.id ?? null;
};

const useInboxKeys = (
  inbox: InboxState,
  itemId: string | null,
  view: React.RefObject<ItemViewHandle | null>,
) => {
  const state = useRef({ inbox, itemId });
  state.current = { inbox, itemId };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      const handled = handleKey(event.key.toLowerCase(), state.current, view.current);
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);
};

const handleKey = (
  key: string,
  { inbox, itemId }: { inbox: InboxState; itemId: string | null },
  view: ItemViewHandle | null,
): boolean => {
  if (key === "j" || key === "k") {
    const items = inbox.items ?? [];
    const at = items.findIndex((item) => item.id === itemId);
    const next = items[key === "j" ? at + 1 : Math.max(0, at - 1)] ?? items[0];
    if (next) navigate(inboxPath(next.id), { replace: true });
    return Boolean(next);
  }
  const action = view ? KEY_ACTIONS[key]?.(view) : undefined;
  return action !== undefined;
};

const KEY_ACTIONS: Record<string, (view: ItemViewHandle) => true> = {
  e: (view) => {
    view.done();
    return true;
  },
  r: (view) => {
    view.reply();
    return true;
  },
  d: (view) => {
    view.dispatch();
    return true;
  },
  o: (view) => {
    view.openInSlack();
    return true;
  },
};

const typing = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};
