import type { Project, Thread } from "@aop/common";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { markThreadRead } from "../../api/threads";
import { Link, projectPath } from "../../shell/router";
import { pullRequestOf } from "../selectors";
import { ThreadsLoadError } from "../ThreadsLoadError";
import { ThreadChanges } from "./changes/ThreadChanges";
import { useThreadDiff } from "./changes/use-thread-diff";
import { PullRequestBar, PullRequestProblemNotice } from "./PullRequestBar";
import { ThreadHeader } from "./ThreadHeader";
import { ThreadNotice } from "./ThreadNotice";
import { ThreadTranscript } from "./ThreadTranscript";
import { usePullRequestControls } from "./use-pull-request";

type Tab = "transcript" | "changes";

/**
 * One thread: who it is, where its pull request stands, what is going on with it, and then
 * either its conversation (with the box to steer it, or the question it waits on) or the files
 * it changed. `thread` is undefined for an id the project does not have.
 */
export const ThreadPane = ({
  project,
  thread,
  threads,
  threadsLoaded,
  threadsError,
  headerActions,
}: {
  project: Project;
  thread: Thread | undefined;
  threads: readonly Thread[];
  threadsLoaded: boolean;
  threadsError: string | null;
  /** The holder's buttons (expand, close), drawn in the thread's header. */
  headerActions?: React.ReactNode;
}) => {
  if (thread) {
    return (
      <ThreadView
        key={thread.id}
        project={project}
        thread={thread}
        threads={threads}
        threadsLoaded={threadsLoaded}
        threadsError={threadsError}
        headerActions={headerActions}
      />
    );
  }
  if (threadsLoaded) return <ThreadMissing project={project} />;
  if (threadsError) {
    return (
      <ThreadsLoadError
        projectId={project.id}
        subject="this thread"
        error={threadsError}
        className="p-6 text-body"
      />
    );
  }
  return <ThreadLoading />;
};

const ThreadView = ({
  project,
  thread,
  threads,
  threadsLoaded,
  threadsError,
  headerActions,
}: {
  project: Project;
  thread: Thread;
  threads: readonly Thread[];
  threadsLoaded: boolean;
  threadsError: string | null;
  headerActions?: React.ReactNode;
}) => {
  const [tab, setTab] = useState<Tab>("transcript");
  useMarkRead(thread);
  // A turn that ends, or a pull request that changes, is when the worktree may have changed.
  const view = useThreadDiff(
    thread.id,
    `${thread.status}:${thread.lastActivityAt}:${pullRequestOf(thread)?.state ?? ""}`,
    tab === "changes",
  );
  const changed = view.diff?.files.length ?? 0;
  const pullRequest = usePullRequestControls(thread.id);

  return (
    <div
      data-testid="thread-pane"
      data-thread-id={thread.id}
      data-status={thread.status}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ThreadHeader project={project} thread={thread} actions={headerActions} />
      {thread.repoId ? (
        <>
          <div className="mt-1.5 flex flex-wrap items-end gap-x-5 border-b border-border px-6">
            <nav aria-label="Thread" className="flex items-end gap-5">
              <TabButton
                active={tab === "transcript"}
                onSelect={() => setTab("transcript")}
                testId="thread-tab-transcript"
              >
                Transcript
              </TabButton>
              <TabButton
                active={tab === "changes"}
                onSelect={() => setTab("changes")}
                testId="thread-tab-changes"
              >
                Changes
                {changed > 0 ? (
                  <span
                    data-testid="thread-tab-changes-count"
                    className="ml-1.5 rounded-md bg-hover px-1.5 text-xs font-semibold tabular-nums text-text-muted"
                  >
                    {changed}
                  </span>
                ) : null}
              </TabButton>
            </nav>
            <span className="flex-1" />
            <div className="flex min-h-9 max-w-full items-center py-0.5">
              <PullRequestBar thread={thread} controls={pullRequest} />
            </div>
          </div>
          <PullRequestProblemNotice controls={pullRequest} />
        </>
      ) : null}
      <ThreadNotice thread={thread} />
      {tab === "changes" && thread.repoId ? (
        <ThreadChanges thread={thread} view={view} onReviewSent={() => setTab("transcript")} />
      ) : null}
      {/* Kept mounted behind the Changes tab, so the conversation keeps its place and its draft. */}
      <div className={cn("min-h-0 flex-1 flex-col", tab === "transcript" ? "flex" : "hidden")}>
        <ThreadTranscript
          project={project}
          thread={thread}
          threads={threads}
          threadsLoaded={threadsLoaded}
          threadsError={threadsError}
        />
      </div>
    </div>
  );
};

const TabButton = ({
  active,
  onSelect,
  testId,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  testId: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-current={active ? "page" : undefined}
    onClick={onSelect}
    className={cn(
      "-mb-px flex h-10 items-center border-b-2 text-body font-medium transition-colors duration-[120ms]",
      active ? "border-text text-text" : "border-transparent text-text-muted hover:text-text",
    )}
  >
    {children}
  </button>
);

// Looking at a thread is reading it: the host clears its unread flag, while the page is visible.
const useMarkRead = (thread: Thread): void => {
  const { id, unread } = thread;
  useEffect(() => {
    if (!unread) return;
    const mark = () => {
      if (document.visibilityState !== "hidden") void markThreadRead(id).catch(() => {});
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [id, unread]);
};

const ThreadLoading = () => (
  <p data-testid="thread-loading" className="p-6 text-body text-text-subtle">
    Loading thread…
  </p>
);

const ThreadMissing = ({ project }: { project: Project }) => (
  <div
    data-testid="thread-not-found"
    className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-16 text-center"
  >
    <h2 className="text-title font-medium text-text">Thread not found</h2>
    <p className="max-w-sm text-body text-text-subtle">
      It may have been deleted, or it belongs to another project.
    </p>
    <Link to={projectPath(project.id)} className="mt-2 text-body text-running hover:underline">
      Back to the project
    </Link>
  </div>
);
