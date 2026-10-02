import type {
  PullRequestListItem,
  PullRequestListRepo,
  PullRequestListResponse,
} from "@aop/common";
import {
  AlertTriangleIcon,
  FolderGit2Icon,
  GitPullRequestIcon,
  KeyRoundIcon,
  TerminalIcon,
  WifiOffIcon,
} from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useMemo, useRef } from "react";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";
import { isProjectScreen, useRoute } from "../../shell/router";
import type { ProjectEntry } from "../projects-state";
import { openPullRequestView } from "../pull-request-view/open-pull-request-view";
import { formatAgo } from "../selectors";
import { useSharedNow } from "../use-now";
import { PullRequestRow } from "./PullRequestRow";
import { PullRequestToolbar, ResultLine } from "./PullRequestToolbar";
import {
  activeFilterCount,
  type PullRequestFilterControls,
  type PullRequestFilters,
  usePullRequestFilters,
} from "./pull-request-filters";
import {
  type PullRequestList,
  type PullRequestListOptions,
  type ReadyList,
  usePullRequestList,
} from "./use-pull-request-list";

/**
 * The Pull requests tab: every pull request of the project's GitHub repositories, open and
 * closed, read through the host's GitHub CLI. Choosing one opens it in the PR View where the
 * coordinator chat is; the list stays here beside it.
 */
export const PullRequestsTab = ({
  entry,
  options,
}: {
  entry: ProjectEntry;
  /** For tests: how the list is read and how often. */
  options?: PullRequestListOptions;
}) => {
  const projectId = entry.project.id;
  const controls = usePullRequestFilters(projectId);
  const list = usePullRequestList(projectId, controls.filters, options);
  const searchRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  useSlashToSearch(tabRef, searchRef);
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollToTopOn(scrollRef, controls.filters);
  const ready = list.response?.status === "ready" ? list.response : null;

  return (
    <div ref={tabRef} data-testid="pull-requests-tab" className="flex min-h-0 flex-1 flex-col">
      {list.response?.status === "unavailable" ? null : (
        <PullRequestToolbar
          controls={controls}
          facets={ready?.facets ?? null}
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          searchRef={searchRef}
        />
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="pr-scroll">
        <Body entry={entry} list={list} controls={controls} />
      </div>
    </div>
  );
};

const Body = ({
  entry,
  list,
  controls,
}: {
  entry: ProjectEntry;
  list: PullRequestList;
  controls: PullRequestFilterControls;
}) => {
  if (list.loading) return <LoadingRows />;
  if (!list.response) {
    return <ReadFailed message={list.error ?? "Unknown error"} onRetry={list.refresh} />;
  }
  if (list.response.status === "unavailable") {
    return <Unavailable response={list.response} onRetry={list.refresh} />;
  }
  return <ReadyBody entry={entry} list={list} ready={list.response} controls={controls} />;
};

const ReadyBody = ({
  entry,
  list,
  ready,
  controls,
}: {
  entry: ProjectEntry;
  list: PullRequestList;
  ready: ReadyList;
  controls: PullRequestFilterControls;
}) => {
  const now = useSharedNow();
  const selected = useSelectedPullRequest(entry.project.id);
  const threadTitles = useMemo(
    () => new Map(entry.threads.map((thread) => [thread.id, thread.title])),
    [entry.threads],
  );
  return (
    <div className="flex flex-col pb-3">
      {list.error ? <StaleNotice message={list.error} /> : null}
      <RepoNotices repos={ready.repos} />
      <ResultLine total={ready.total} controls={controls} />
      {list.items.length === 0 ? (
        <NoMatch
          filtered={activeFilterCount(controls.filters) > 0}
          onClearFilters={controls.clear}
        />
      ) : (
        <ul
          data-testid="pr-list"
          aria-label="Pull requests"
          className="flex flex-col gap-0.5 px-1.5"
          onKeyDown={moveBetweenRows}
        >
          {list.items.map((pull) => (
            <li key={`${pull.repoId}#${pull.number}`}>
              <PullRequestRow
                pull={pull}
                projectId={entry.project.id}
                threadTitle={pull.threadId ? (threadTitles.get(pull.threadId) ?? null) : null}
                selected={selected === `${pull.repoId}#${pull.number}`}
                now={now}
                onOpen={(item) => open(entry.project.id, item)}
              />
            </li>
          ))}
        </ul>
      )}
      {ready.nextCursor ? (
        <div className="px-3 pt-2">
          <Button
            variant="ghost"
            data-testid="pr-load-more"
            disabled={list.loadingMore}
            onClick={list.loadMore}
            className="w-full text-meta text-text-muted"
          >
            {list.loadingMore ? "Loading…" : `Show more (${ready.total - list.items.length} left)`}
          </Button>
        </div>
      ) : null}
      <ListFooter ready={ready} now={now} />
    </div>
  );
};

const open = (projectId: string, pull: PullRequestListItem) =>
  openPullRequestView({ projectId, repoId: pull.repoId, number: pull.number });

/** `repoId#number` of the pull request the PR View shows for this project, if any. */
const useSelectedPullRequest = (projectId: string): string | null => {
  const route = useRoute();
  if (!isProjectScreen(route) || route.projectId !== projectId || !route.pullRequest) return null;
  return `${route.pullRequest.repoId}#${route.pullRequest.number}`;
};

/** Up and Down move between the rows' open buttons, as in a list box. */
const moveBetweenRows = (event: KeyboardEvent<HTMLElement>) => {
  const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
  if (!step) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-pr-row-button]")];
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  if (at === -1) return;
  event.preventDefault();
  buttons[Math.min(buttons.length - 1, Math.max(0, at + step))]?.focus();
};

/** Another filter is another list: it starts at its top, not where the last one was scrolled to. */
const useScrollToTopOn = (scroll: RefObject<HTMLElement | null>, filters: PullRequestFilters) => {
  const key = JSON.stringify(filters);
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [scroll, key]);
};

/** "/" anywhere in the tab but a text box goes to the search, as on GitHub. */
const useSlashToSearch = (
  tab: RefObject<HTMLElement | null>,
  search: RefObject<HTMLInputElement | null>,
) => {
  useEffect(() => {
    const element = tab.current;
    if (!element) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== "/" || target.closest("input, textarea, [contenteditable=true]")) return;
      event.preventDefault();
      search.current?.focus();
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, [tab, search]);
};

const LoadingRows = () => (
  <div
    data-testid="pr-loading"
    role="status"
    aria-busy="true"
    aria-label="Loading pull requests"
    className="flex flex-col gap-3 px-4 py-3"
  >
    {[0, 1, 2, 3, 4].map((row) => (
      <div key={row} className="flex gap-2.5">
        <Skeleton className="mt-0.5 size-4 rounded-full" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>
    ))}
  </div>
);

const UNAVAILABLE: Record<
  Extract<PullRequestListResponse, { status: "unavailable" }>["reason"],
  { icon: typeof KeyRoundIcon; title: string; hint?: string }
> = {
  "no-repos": { icon: FolderGit2Icon, title: "No repositories yet" },
  "no-github-repos": { icon: FolderGit2Icon, title: "No GitHub repositories" },
  "gh-missing": { icon: TerminalIcon, title: "GitHub CLI not found", hint: "brew install gh" },
  "signed-out": { icon: KeyRoundIcon, title: "Not signed in to GitHub", hint: "gh auth login" },
  unreachable: { icon: WifiOffIcon, title: "GitHub is out of reach" },
};

const Unavailable = ({
  response,
  onRetry,
}: {
  response: Extract<PullRequestListResponse, { status: "unavailable" }>;
  onRetry: () => void;
}) => {
  const { icon: Icon, title, hint } = UNAVAILABLE[response.reason];
  return (
    <Notice
      testId="pr-unavailable"
      reason={response.reason}
      icon={<Icon className="size-5" />}
      title={title}
      message={response.message}
    >
      {hint ? (
        <code className="rounded-md border border-border bg-raised px-2 py-1 font-mono text-[12px] text-text">
          {hint}
        </code>
      ) : null}
      {response.reason === "no-repos" || response.reason === "no-github-repos" ? null : (
        <Button variant="outline" size="sm" data-testid="pr-retry" onClick={onRetry}>
          Check again
        </Button>
      )}
    </Notice>
  );
};

const ReadFailed = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <Notice
    testId="pr-error"
    icon={<AlertTriangleIcon className="size-5" />}
    title="Could not list pull requests"
    message={message}
  >
    <Button variant="outline" size="sm" data-testid="pr-retry" onClick={onRetry}>
      Try again
    </Button>
  </Notice>
);

const Notice = ({
  testId,
  reason,
  icon,
  title,
  message,
  children,
}: {
  testId: string;
  reason?: string;
  icon: React.ReactNode;
  title: string;
  message: string;
  children?: React.ReactNode;
}) => (
  <div
    data-testid={testId}
    data-reason={reason}
    className="flex flex-col items-center gap-3 px-6 py-12 text-center"
  >
    <span className="grid size-10 place-items-center rounded-card border border-border bg-raised text-text-muted">
      {icon}
    </span>
    <div className="flex max-w-xs flex-col gap-1">
      <p className="text-body font-medium text-text">{title}</p>
      <p className="text-meta text-text-subtle">{message}</p>
    </div>
    {children}
  </div>
);

const NoMatch = ({
  filtered,
  onClearFilters,
}: {
  filtered: boolean;
  onClearFilters: () => void;
}) => (
  <Notice
    testId="pr-empty"
    icon={<GitPullRequestIcon className="size-5" />}
    title={filtered ? "No pull requests match" : "No pull requests here"}
    message={
      filtered
        ? "Try another search or fewer filters."
        : "None of this project's repositories has a pull request in this state."
    }
  >
    {filtered ? (
      <Button variant="outline" size="sm" data-testid="pr-empty-clear" onClick={onClearFilters}>
        Clear filters
      </Button>
    ) : null}
  </Notice>
);

/** The last read failed: what is shown is older than it looks. */
const StaleNotice = ({ message }: { message: string }) => (
  <p
    data-testid="pr-stale"
    role="status"
    className="mx-3 mb-2 rounded-row border border-waiting/30 bg-waiting/10 px-3 py-2 text-meta text-waiting"
  >
    Could not refresh: {message}
  </p>
);

/** A repository whose pull requests could not be read now; its last good read stays listed. */
const RepoNotices = ({ repos }: { repos: readonly PullRequestListRepo[] }) => {
  const failed = repos.filter((repo) => repo.error);
  if (failed.length === 0) return null;
  return (
    <div data-testid="pr-repo-errors" className="mx-3 mb-2 flex flex-col gap-1">
      {failed.map((repo) => (
        <p
          key={repo.repoId}
          role="status"
          className="rounded-row border border-blocked/30 bg-blocked/10 px-3 py-2 text-meta text-blocked"
        >
          <span className="font-medium">{repo.nameWithOwner ?? repo.name}</span>: {repo.error}
        </p>
      ))}
    </div>
  );
};

/** When GitHub was read, and which repositories are not on GitHub or have more than was read. */
const ListFooter = ({ ready, now }: { ready: ReadyList; now: number }) => {
  const local = ready.repos.filter((repo) => repo.nameWithOwner === null);
  const truncated = ready.repos.filter((repo) => repo.truncated);
  return (
    <div data-testid="pr-footer" className="flex flex-col gap-1 px-4 pt-3 text-xs text-text-subtle">
      <span data-testid="pr-fetched-at">Read from GitHub {formatAgo(ready.fetchedAt, now)}</span>
      {truncated.length > 0 ? (
        <span data-testid="pr-truncated">
          Only the most recently updated pull requests of{" "}
          {truncated.map((repo) => repo.nameWithOwner).join(", ")} are listed.
        </span>
      ) : null}
      {local.length > 0 ? (
        <span data-testid="pr-local-repos">
          Not on GitHub: {local.map((repo) => repo.name).join(", ")}
        </span>
      ) : null}
    </div>
  );
};
