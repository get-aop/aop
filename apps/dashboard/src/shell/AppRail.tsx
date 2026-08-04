import {
  ChevronDownIcon,
  CircleCheckIcon,
  EllipsisIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/empty";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/ui/sidebar";
import type { ChatSessionSummary } from "../api/client";
import type { ConnectionState } from "../types";
import { canSettleSession, isSessionLifecycleBusy } from "../views/sessions/session-settled";
import { openSettingsDialog } from "./dialog-store";
import { RailFooter } from "./rail-footer";
import { type RailProps, useRailProps } from "./rail-store";
import { RepoScopeChips, type ScopeRepo, useRepoScope } from "./repo-scope";
import { useNewSession } from "./use-new-session";

const THREAD_PAGE_SIZE = 12;

/** The app's only chrome (PLAN §3 anatomy): brand, new session, scope chips, one flat thread list, settled, footer. */
export const AppRail = ({
  connection,
  onOpenCommand,
}: {
  connection: ConnectionState;
  onOpenCommand: () => void;
}) => {
  const rail = useRailProps();
  const { scope, setScope, toggle } = useRepoScope();
  const newSession = useNewSession(rail);
  const [visibleLimit, setVisibleLimit] = useState(THREAD_PAGE_SIZE);
  const [deleteTarget, setDeleteTarget] = useState<ChatSessionSummary | null>(null);

  const scopeRepos = useMemo<ScopeRepo[]>(
    () =>
      (rail?.groups ?? []).map((group) => ({
        id: group.repoId,
        name: group.name,
        sessionCount: group.sessions.length,
        lastActivityAt:
          group.sessions.reduce<string | null>(
            (latest, s) => ((s.lastActivityAt ?? "") > (latest ?? "") ? s.lastActivityAt : latest),
            null,
          ) ?? null,
        hasRunning: group.sessions.some((s) => isSessionLifecycleBusy(s)),
      })),
    [rail?.groups],
  );

  const threads = useMemo(() => {
    if (!rail) return [];
    const scoped = new Set(scope ?? []);
    const fromGroups = rail.groups
      .filter((group) => scope === null || scoped.has(group.repoId))
      .flatMap((group) => group.sessions.map((session) => ({ session, repoName: group.name })));
    const fromTasks =
      scope === null ? rail.tasks.map((session) => ({ session, repoName: null })) : [];
    return [...fromGroups, ...fromTasks].sort(compareThreads);
  }, [rail, scope]);

  const multiRepo = (rail?.groups.length ?? 0) > 1;
  const showRepoTags = multiRepo && (scope === null || scope.length > 1);
  const visibleThreads = threads.slice(0, visibleLimit);
  const hiddenCount = threads.length - visibleThreads.length;

  return (
    <Sidebar data-testid="app-rail">
      <RailHeader
        rail={rail}
        scope={scope}
        scopeRepos={scopeRepos}
        onOpenCommand={onOpenCommand}
        onNewSession={newSession}
        onToggleScope={(id) => {
          toggle(id);
          setVisibleLimit(THREAD_PAGE_SIZE);
        }}
        onResetScope={() => {
          setScope(null);
          setVisibleLimit(THREAD_PAGE_SIZE);
        }}
      />

      <RailThreadList
        rail={rail}
        threads={visibleThreads}
        hiddenCount={hiddenCount}
        scoped={scope !== null}
        showRepoTags={showRepoTags}
        onShowMore={() => setVisibleLimit((limit) => limit + THREAD_PAGE_SIZE)}
        onDelete={setDeleteTarget}
      />

      {rail && rail.settled.length > 0 ? (
        <div className="px-2 pb-1">
          <Collapsible>
            <CollapsibleTrigger
              data-testid="rail-settled"
              className="flex h-8 w-full items-center gap-2 rounded-row px-2 text-[12.5px] font-medium text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text"
            >
              <ChevronDownIcon className="size-3.5 transition-transform [[data-state=closed]>&]:-rotate-90" />
              Settled · {rail.settled.length}
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-0.5 pt-0.5">
              {rail.settled.map((session) => (
                <ThreadRow
                  key={session.id}
                  session={session}
                  repoTag={showRepoTags ? session.repoName : null}
                  active={session.id === rail.activeSessionId}
                  settled
                  onSelect={() => rail.onSelect(session.id)}
                  onAction={(action) =>
                    action === "delete"
                      ? setDeleteTarget(session)
                      : rail.onAction(session.id, action)
                  }
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}

      <SidebarFooter className="border-t border-border p-0">
        <RailFooter connection={connection} workflowCount={rail?.workflowCount ?? 0} />
      </SidebarFooter>

      <DeleteSessionDialog
        session={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) rail?.onAction(deleteTarget.id, "delete");
          setDeleteTarget(null);
        }}
      />
    </Sidebar>
  );
};

const compareThreads = (
  a: { session: ChatSessionSummary },
  b: { session: ChatSessionSummary },
): number => {
  if (a.session.pinned !== b.session.pinned) return a.session.pinned ? -1 : 1;
  return (b.session.lastActivityAt ?? b.session.updatedAt).localeCompare(
    a.session.lastActivityAt ?? a.session.updatedAt,
  );
};

const RailHeader = ({
  rail,
  scope,
  scopeRepos,
  onOpenCommand,
  onNewSession,
  onToggleScope,
  onResetScope,
}: {
  rail: RailProps | null;
  scope: string[] | null;
  scopeRepos: ScopeRepo[];
  onOpenCommand: () => void;
  onNewSession: () => void;
  onToggleScope: (repoId: string) => void;
  onResetScope: () => void;
}) => (
  <SidebarHeader className="gap-1 p-2">
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="rail-brand"
            className="flex h-8 flex-1 items-center gap-1 rounded-row px-2 text-[14px] font-semibold text-text transition-colors duration-[120ms] hover:bg-hover"
          >
            AOP
            <ChevronDownIcon className="size-3.5 text-text-subtle" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => openSettingsDialog("about")}>
            About AOP
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        data-testid="rail-search"
        aria-label="Search sessions (⌘K)"
        onClick={onOpenCommand}
        className="grid size-8 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <SearchIcon className="size-4" strokeWidth={1.7} />
      </button>
    </div>
    <button
      type="button"
      data-testid="rail-new-session"
      onClick={onNewSession}
      className="flex h-8 items-center gap-2 rounded-row px-2 text-[13px] font-medium text-text transition-colors duration-[120ms] hover:bg-hover"
    >
      <SquarePenIcon className="size-4 text-text-muted" strokeWidth={1.7} />
      <span className="flex-1 text-left">New session</span>
      <kbd className="text-[11px] text-text-subtle">⌘N</kbd>
    </button>
    <div className="flex items-center px-2 pt-2">
      <span className="flex-1 text-[11.5px] font-medium text-text-subtle">Projects</span>
      <button
        type="button"
        data-testid="rail-attach-repo"
        aria-label="Attach repository"
        onClick={() => rail?.onAttachRepo()}
        className="grid size-5 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
    <RepoScopeChips
      repos={scopeRepos}
      scope={scope}
      onToggle={onToggleScope}
      onReset={onResetScope}
    />
  </SidebarHeader>
);

interface FlatThread {
  session: ChatSessionSummary;
  repoName: string | null;
}

const RailThreadList = ({
  rail,
  threads,
  hiddenCount,
  scoped,
  showRepoTags,
  onShowMore,
  onDelete,
}: {
  rail: RailProps | null;
  threads: FlatThread[];
  hiddenCount: number;
  scoped: boolean;
  showRepoTags: boolean;
  onShowMore: () => void;
  onDelete: (session: ChatSessionSummary) => void;
}) => {
  const noRepos = rail !== null && rail.groups.length === 0;
  let body: React.ReactNode;
  if (rail === null) {
    body = <div className="px-2 text-[12px] text-text-subtle">Loading sessions…</div>;
  } else if (noRepos) {
    body = (
      <Empty className="gap-3 px-4 py-6">
        <EmptyMedia variant="icon">
          <FolderIcon className="size-4" />
        </EmptyMedia>
        <EmptyHeader className="max-w-52">
          <EmptyTitle className="text-[13px]">No repositories yet</EmptyTitle>
          <EmptyDescription className="text-[12px]">
            Attach a repository to start working on your code.
          </EmptyDescription>
        </EmptyHeader>
        <button
          type="button"
          data-testid="rail-attach-empty-cta"
          onClick={() => rail.onAttachRepo()}
          // The rail is narrow enough that the label wraps and tears away from
          // the icon inside the fixed h-7 box — nowrap keeps them on one line.
          className="flex h-7 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-raised px-2.5 text-[12px] font-medium text-text transition-colors duration-[120ms] hover:bg-hover"
        >
          <PlusIcon className="size-3 shrink-0" />
          Attach a repository
        </button>
      </Empty>
    );
  } else if (threads.length === 0) {
    body = (
      <div className="px-2 py-3 text-center text-[12px] text-text-subtle">
        {scoped ? "No sessions in this scope" : "No sessions yet"}
      </div>
    );
  } else {
    body = (
      <div data-testid="rail-thread-list" className="flex flex-col gap-0.5">
        {threads.map(({ session, repoName }) => (
          <ThreadRow
            key={session.id}
            session={session}
            repoTag={showRepoTags ? repoName : null}
            active={session.id === rail.activeSessionId}
            settled={false}
            onSelect={() => rail.onSelect(session.id)}
            onAction={(action) =>
              action === "delete" ? onDelete(session) : rail.onAction(session.id, action)
            }
          />
        ))}
      </div>
    );
  }
  return (
    <SidebarContent className="px-2 pt-[18px]">
      {body}
      {hiddenCount > 0 ? (
        <button
          type="button"
          data-testid="rail-show-more"
          onClick={onShowMore}
          className="mt-1 flex h-7 w-full items-center rounded-row px-2 text-[12px] text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
        >
          Show more · {hiddenCount}
        </button>
      ) : null}
    </SidebarContent>
  );
};

const DeleteSessionDialog = ({
  session,
  onCancel,
  onConfirm,
}: {
  session: ChatSessionSummary | null;
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <AlertDialog open={session !== null} onOpenChange={(open) => !open && onCancel()}>
    <AlertDialogContent className="w-[512px]">
      <AlertDialogHeader>
        <AlertDialogTitle>Delete session?</AlertDialogTitle>
        <AlertDialogDescription>
          “{session?.title}” will be permanently deleted. This cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction data-testid="rail-delete-confirm" onClick={onConfirm}>
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** One status glyph: running dot > blocked dot > PR glyph > unread dot. */
const StatusGlyph = ({ session }: { session: ChatSessionSummary }) => {
  if (isSessionLifecycleBusy(session)) {
    return (
      <span
        data-testid="rail-glyph-running"
        className="aop-running-dot size-1.5 shrink-0 rounded-full bg-running motion-safe:animate-[aop-pulse_2s_ease-in-out_infinite]"
      />
    );
  }
  if (session.hasPendingApproval) {
    return (
      <span
        data-testid="rail-glyph-blocked"
        className="size-1.5 shrink-0 rounded-full bg-blocked"
      />
    );
  }
  if (session.unreadCount > 0) {
    return (
      <span data-testid="rail-glyph-unread" className="size-1.5 shrink-0 rounded-full bg-unread" />
    );
  }
  return null;
};

const ThreadRow = ({
  session,
  repoTag,
  active,
  settled,
  onSelect,
  onAction,
}: {
  session: ChatSessionSummary;
  repoTag: string | null;
  active: boolean;
  settled: boolean;
  onSelect: () => void;
  onAction: (action: "rename" | "pin" | "settle" | "unsettle" | "delete") => void;
}) => (
  <div
    data-testid="rail-thread-row"
    data-session-id={session.id}
    className={cn(
      // Named group: the sidebar wrapper is itself a `group`, so a bare
      // group-hover would reveal every row's actions at once.
      "group/row relative flex h-8 items-center gap-2 rounded-row px-2 text-[13px]",
      active ? "bg-active text-text" : "text-text-muted hover:bg-hover hover:text-text",
    )}
  >
    <StatusGlyph session={session} />
    <button
      type="button"
      onClick={onSelect}
      className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          session.unreadCount > 0 && "font-medium text-text",
        )}
      >
        {session.title}
      </span>
      {repoTag ? (
        // Shrinks (and truncates) ahead of the title so the row still fits once
        // the hover actions claim their space.
        <span
          title={repoTag}
          className="flex min-w-0 max-w-[45%] shrink items-center gap-1 text-[11px] text-text-subtle"
        >
          <FolderIcon className="size-3 shrink-0" />
          <span className="truncate">{repoTag}</span>
        </span>
      ) : null}
    </button>
    {/* In flow rather than absolutely positioned: an overlay would sit on top of
        the repo tag. Stays mounted while the menu is open, because hiding it on
        pointer-out collapses the trigger to a 0x0 rect and the popup reanchors
        to the viewport origin. */}
    <span className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex has-[[data-state=open]]:flex">
      {!settled && canSettleSession(session) ? (
        <button
          type="button"
          data-testid="rail-row-settle"
          aria-label="Settle session"
          onClick={() => onAction("settle")}
          className="grid size-6 place-items-center rounded text-text-subtle hover:bg-active hover:text-text"
        >
          <CircleCheckIcon className="size-3.5" strokeWidth={1.7} />
        </button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="rail-row-menu"
            aria-label="Session actions"
            className="grid size-6 place-items-center rounded text-text-subtle hover:bg-active hover:text-text"
          >
            <EllipsisIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onAction("rename")}>Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction("pin")}>
            {session.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction(settled ? "unsettle" : "settle")}>
            {settled ? "Unsettle" : "Settle"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </div>
);
