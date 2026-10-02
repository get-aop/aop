import type { PullRequestViewDetail } from "@aop/common";
import {
  AlertTriangleIcon,
  FileDiffIcon,
  GitCommitHorizontalIcon,
  ListChecksIcon,
  MessageSquareIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { ApiError } from "../../api/request";
import type { PullRequestViewRef } from "../../shell/router";
import type { ProjectEntry } from "../projects-state";
import { coordinatorMessage } from "./AskCoordinator";
import { ChecksTab } from "./ChecksTab";
import { CommitsTab } from "./CommitsTab";
import { ConversationTab } from "./ConversationTab";
import { FilesTab } from "./FilesTab";
import { threadOwningPullRequest } from "./owning-thread";
import { PullRequestHeader } from "./PullRequestHeader";
import { PullRequestSidebar } from "./PullRequestSidebar";
import { usePullRequestActions } from "./use-pull-request-actions";
import { usePullRequestView } from "./use-pull-request-view";

export type PullRequestTab = "conversation" | "commits" | "checks" | "files";

/** Sends the coordinator a message; true once it is on its way. */
export type AskCoordinator = (text: string) => Promise<boolean>;

/**
 * One pull request as GitHub shows it, in the coordinator's place: the header, the Conversation,
 * Commits, Checks and Files changed tabs, and the sidebar. Everything comes from the host, which
 * reads GitHub with its own `gh` login; only the host owner gets the buttons that change it.
 */
export const PullRequestView = ({
  entry,
  pullRequest,
  onAsk,
}: {
  entry: ProjectEntry;
  pullRequest: PullRequestViewRef;
  onAsk: AskCoordinator;
}) => {
  const key = { projectId: entry.project.id, ...pullRequest };
  const view = usePullRequestView(key);
  const actions = usePullRequestActions(key, view.detail, view.act);
  const [tab, setTab] = useState<PullRequestTab>("conversation");

  if (view.error) {
    return (
      <LoadError
        error={view.error}
        retrying={view.refreshing}
        onRetry={() => void view.refresh()}
      />
    );
  }
  if (!view.detail) return <Loading />;
  const { detail } = view;
  const owner = threadOwningPullRequest(entry.threads, pullRequest);
  const ask = (question: string) => onAsk(coordinatorMessage(detail, question));

  const files = tab === "files";
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as PullRequestTab)}
      data-testid="pull-request-view"
      data-state={detail.state}
      data-tab={tab}
      // The Files tab scrolls its own diff, so the page around it holds still; the other tabs
      // scroll as one page, header included, with the tab bar staying at the top.
      className={cn(
        "@container min-h-0 flex-1 gap-0",
        files ? "flex flex-col" : "block overflow-auto",
      )}
    >
      <div className="shrink-0 px-6 pt-5">
        <PullRequestHeader
          detail={detail}
          actions={actions}
          refreshing={view.refreshing}
          onRefresh={() => void view.refresh()}
          onAsk={ask}
          compact={files}
        />
        {view.stale ? <StaleNote error={view.stale} /> : null}
      </div>
      <div className="sticky top-0 z-20 flex shrink-0 items-center gap-3 border-b border-border bg-background px-6">
        {/* One row that scrolls sideways when the pane is narrow: wrapped tabs would spill out of
            the fixed-height bar onto the content below. */}
        <TabsList
          variant="line"
          data-testid="pr-tabs"
          className="h-11 min-w-0 max-w-full shrink justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
        >
          <Tab
            value="conversation"
            icon={<MessageSquareIcon />}
            label="Conversation"
            count={detail.commentCount}
          />
          <Tab
            value="commits"
            icon={<GitCommitHorizontalIcon />}
            label="Commits"
            count={detail.commitCount}
          />
          <Tab
            value="checks"
            icon={<ListChecksIcon />}
            label="Checks"
            count={detail.checks.total}
          />
          <Tab
            value="files"
            icon={<FileDiffIcon />}
            label="Files changed"
            count={detail.changedFiles}
          />
        </TabsList>
        <DiffStat detail={detail} />
      </div>
      <TabsContent value="conversation">
        <WithSidebar detail={detail} owner={owner} pullRequest={pullRequest}>
          <ConversationTab detail={detail} actions={actions} />
        </WithSidebar>
      </TabsContent>
      <TabsContent value="commits" className="px-6 py-5">
        <CommitsTab detail={detail} />
      </TabsContent>
      <TabsContent value="checks" className="px-6 py-5">
        <ChecksTab detail={detail} />
      </TabsContent>
      <TabsContent value="files" className="flex min-h-0 flex-col">
        <FilesTab pullKey={key} detail={detail} />
      </TabsContent>
    </Tabs>
  );
};

const Tab = ({
  value,
  icon,
  label,
  count,
}: {
  value: PullRequestTab;
  icon: ReactNode;
  label: string;
  count: number;
}) => (
  <TabsTrigger value={value} data-testid={`pr-tab-${value}`} className="flex-none px-3">
    {icon}
    {label}
    <span className="rounded-full bg-raised px-1.5 text-[11px] text-text-muted tabular-nums">
      {count.toLocaleString()}
    </span>
  </TabsTrigger>
);

const DiffStat = ({ detail }: { detail: PullRequestViewDetail }) => (
  <span
    data-testid="pr-diffstat"
    className="ml-auto hidden shrink-0 font-mono text-[12px] @xl:inline"
  >
    <span className="text-ok">+{detail.additions.toLocaleString()}</span>{" "}
    <span className="text-blocked">−{detail.deletions.toLocaleString()}</span>
  </span>
);

/** The main column and, on a wide enough pane, the sidebar beside it; below it on a narrow one. */
const WithSidebar = ({
  detail,
  owner,
  pullRequest,
  children,
}: {
  detail: PullRequestViewDetail;
  owner: Parameters<typeof PullRequestSidebar>[0]["owner"];
  pullRequest: PullRequestViewRef;
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-6 px-6 py-5 @3xl:flex-row">
    <div className="min-w-0 flex-1">{children}</div>
    <div className="@3xl:w-56 @3xl:shrink-0 @5xl:w-64">
      <PullRequestSidebar detail={detail} owner={owner} pullRequest={pullRequest} />
    </div>
  </div>
);

const Loading = () => (
  <div
    data-testid="pull-request-view-loading"
    aria-busy="true"
    className="flex flex-col gap-4 px-6 py-5"
  >
    <Skeleton className="h-8 w-3/4" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-10 w-full" />
    <Skeleton className="h-40 w-full" />
  </div>
);

const ERROR_TITLE: Record<string, string> = {
  GITHUB_NOT_CONNECTED: "The host is not connected to GitHub",
  NO_GITHUB_REMOTE: "This repository is not on GitHub",
  PULL_REQUEST_NOT_FOUND: "Pull request not found",
  REPO_NOT_IN_PROJECT: "Not one of this project's repositories",
  GITHUB_RATE_LIMITED: "GitHub is rate limiting the host",
};

const ERROR_HINT: Record<string, string> = {
  GITHUB_NOT_CONNECTED: "Run `gh auth login` on the host machine, then try again.",
  GITHUB_RATE_LIMITED: "Wait a few minutes, then try again.",
};

const LoadError = ({
  error,
  retrying,
  onRetry,
}: {
  error: Error;
  retrying: boolean;
  onRetry: () => void;
}) => {
  const code = error instanceof ApiError ? error.code : "UNKNOWN";
  return (
    <div
      data-testid="pull-request-view-error"
      data-code={code}
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <AlertTriangleIcon className="size-6 text-waiting" aria-hidden="true" />
      <h2 className="text-title font-medium text-text">
        {ERROR_TITLE[code] ?? "Could not load the pull request"}
      </h2>
      <p className="max-w-md text-body text-text-muted">{error.message}</p>
      {ERROR_HINT[code] ? (
        <p className="max-w-md text-meta text-text-subtle">{ERROR_HINT[code]}</p>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        className="mt-2"
        data-testid="pull-request-view-retry"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? "Trying…" : "Try again"}
      </Button>
    </div>
  );
};

const StaleNote = ({ error }: { error: Error }) => (
  <p
    data-testid="pull-request-view-stale"
    className="mt-2 flex items-center gap-1.5 text-meta text-waiting"
  >
    <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
    Could not refresh: {error.message}. Showing what was read last.
  </p>
);

/** Sends `text` to the coordinator through the project's chat, and tells the person if it failed. */
export const askThroughChat =
  (
    send: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>,
    then: () => void,
  ): AskCoordinator =>
  async (text) => {
    const sent = await send(text);
    if (!sent.ok) {
      toast.error(sent.error);
      return false;
    }
    then();
    return true;
  };
