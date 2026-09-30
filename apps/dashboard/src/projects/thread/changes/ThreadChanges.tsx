import type { SessionGitDiff, Thread } from "@aop/common";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { DiffFiles } from "./DiffFiles";
import { DiffReviewContext } from "./DiffLineComment";
import { ReviewQueue } from "./ReviewQueue";
import { useDiffReview } from "./use-diff-review";
import type { ThreadDiffView } from "./use-thread-diff";

/**
 * What the thread changed in its worktree, against where its branch left the default branch:
 * the files, each opened to its lines, and, on any line, a review comment. Comments queue
 * here and go to the thread together, as one message, when the person sends them.
 */
export const ThreadChanges = ({
  thread,
  view,
  onReviewSent,
}: {
  thread: Thread;
  view: ThreadDiffView;
  onReviewSent: () => void;
}) => {
  const { diff, loading, error } = view;
  const { review, comments } = useDiffReview(thread.id);

  if (loading && !diff) return <Note testId="thread-diff-loading">Loading changes…</Note>;
  if (error) {
    return (
      <Note testId="thread-diff-unavailable" role="alert">
        {thread.status === "resolved"
          ? "This thread is resolved, so its worktree is gone. What it changed is on its branch and in its pull request."
          : error}
      </Note>
    );
  }

  return (
    <div data-testid="thread-changes" className="flex min-h-0 flex-1 flex-col">
      <ChangesHeader thread={thread} diff={diff} view={view} />
      {diff && diff.files.length > 0 ? (
        <DiffReviewContext.Provider value={review}>
          <DiffFiles
            diff={diff}
            collapsed={view.collapsed}
            loadingPaths={view.loadingPaths}
            onToggleFile={view.toggleFile}
          />
        </DiffReviewContext.Provider>
      ) : (
        <Note testId="thread-diff-empty">No changes in this worktree.</Note>
      )}
      <ReviewQueue thread={thread} comments={comments} onSent={onReviewSent} />
    </div>
  );
};

const ChangesHeader = ({
  thread,
  diff,
  view,
}: {
  thread: Thread;
  diff: SessionGitDiff | null;
  view: ThreadDiffView;
}) => {
  const count = diff?.files.length ?? 0;
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-6 text-[12px] text-text-muted">
      <span className="min-w-0 flex-1 truncate">
        <span className="text-text">{diff?.defaultBranch ?? "main"}</span>
        <span className="mx-1.5 text-text-subtle">→</span>
        <span className="text-text">{thread.branch ?? "working tree"}</span>
        {count > 0 ? (
          <span data-testid="thread-diff-file-count" className="ml-2 text-text-subtle">
            {count} {count === 1 ? "file" : "files"}
          </span>
        ) : null}
      </span>
      {count >= 2 ? (
        <>
          <Button type="button" size="xs" variant="ghost" onClick={view.collapseAll}>
            Collapse all
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={view.expandAll}>
            Expand all
          </Button>
        </>
      ) : null}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        data-testid="thread-diff-refresh"
        aria-label="Refresh the changes"
        onClick={view.reload}
      >
        <RefreshCwIcon />
      </Button>
    </header>
  );
};

const Note = ({
  testId,
  role,
  children,
}: {
  testId: string;
  role?: "alert";
  children: React.ReactNode;
}) => (
  <p
    data-testid={testId}
    role={role}
    className="px-6 py-8 text-center text-[13px] text-text-subtle"
  >
    {children}
  </p>
);
