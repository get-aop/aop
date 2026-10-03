import type { Project, Thread } from "@aop/common";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { markThreadRead } from "../../api/threads";
import { Link, projectPath } from "../../shell/router";
import { pullRequestOf } from "../selectors";
import { ThreadsLoadError } from "../ThreadsLoadError";
import { ThreadChanges } from "./changes/ThreadChanges";
import { useThreadDiff } from "./changes/use-thread-diff";
import { ThreadHeader } from "./ThreadHeader";
import { ThreadCuaNotice, ThreadNotice } from "./ThreadNotice";
import { ThreadTranscript } from "./ThreadTranscript";
import { usePullRequestDock } from "./use-pull-request-dock";

/**
 * One thread: who it is, what is going on with it, and its conversation, with the pull request
 * bar and the box to steer it (or the question it waits on) at the bottom. The bar's "N files
 * changed" swaps the conversation for the files the thread changed, and back.
 * `thread` is undefined for an id the project does not have.
 */
export const ThreadPane = ({
  project,
  thread,
  threads,
  threadsLoaded,
  threadsError,
  headerActions,
  headerClose,
}: {
  project: Project;
  thread: Thread | undefined;
  threads: readonly Thread[];
  threadsLoaded: boolean;
  threadsError: string | null;
  /** The holder's buttons (expand), drawn in the thread's header before its menu. */
  headerActions?: React.ReactNode;
  /** The holder's close button, last in the thread's header. */
  headerClose?: React.ReactNode;
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
        headerClose={headerClose}
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
  headerClose,
}: {
  project: Project;
  thread: Thread;
  threads: readonly Thread[];
  threadsLoaded: boolean;
  threadsError: string | null;
  headerActions?: React.ReactNode;
  headerClose?: React.ReactNode;
}) => {
  const [changesOpen, setChangesOpen] = useState(false);
  useMarkRead(thread);
  // A turn that ends, or a pull request that changes, is when the worktree may have changed.
  const view = useThreadDiff(
    thread.id,
    `${thread.status}:${thread.lastActivityAt}:${pullRequestOf(thread)?.state ?? ""}`,
    changesOpen,
  );
  const showChanges = changesOpen && thread.repoId !== null;
  const { dock, bringBack } = usePullRequestDock({
    thread,
    changedFiles: view.diff?.files.length ?? 0,
    changesOpen: showChanges,
    onToggleChanges: () => setChangesOpen((open) => !open),
  });

  return (
    <div
      data-testid="thread-pane"
      data-thread-id={thread.id}
      data-status={thread.status}
      data-view={showChanges ? "changes" : "transcript"}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ThreadHeader
        project={project}
        thread={thread}
        actions={headerActions}
        close={headerClose}
        onShowPullRequestBar={bringBack}
      />
      <ThreadNotice thread={thread} autoContinue={project.autoContinue} />
      <ThreadCuaNotice threadId={thread.id} />
      {showChanges ? (
        <>
          <ThreadChanges
            thread={thread}
            view={view}
            onBack={() => setChangesOpen(false)}
            onReviewSent={() => setChangesOpen(false)}
          />
          <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-3 pt-2 empty:hidden">
            {dock}
          </div>
        </>
      ) : null}
      {/* Kept mounted behind the changes, so the conversation keeps its place and its draft. */}
      <div className={cn("min-h-0 flex-1 flex-col", showChanges ? "hidden" : "flex")}>
        <ThreadTranscript
          project={project}
          thread={thread}
          threads={threads}
          threadsLoaded={threadsLoaded}
          threadsError={threadsError}
          aboveComposer={showChanges ? null : dock}
        />
      </div>
    </div>
  );
};

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
