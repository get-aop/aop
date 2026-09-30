import type { Thread } from "@aop/common";
import { GitBranchIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { checksLabel, PullRequestChip } from "../PullRequestChip";
import { pullRequestOf } from "../selectors";
import { MergeButton, OpenButton, SyncButton } from "./PullRequestButtons";
import type { PullRequestControls, PullRequestProblem } from "./use-pull-request";

/**
 * The thread's code on its way out, in one slim row above its composer: the branch, how many
 * files it changed (which opens them), and "Create PR"; once there is a pull request, that pull
 * request with its checks and "Merge". A thread that changed nothing, or that waits out a rate
 * limit with nothing published, has no bar. The person may send it away (`onHide`) until a pull
 * request exists. What the host refuses is shown by `PullRequestProblemNotice`, above the bar.
 */
export const PullRequestBar = ({
  thread,
  controls,
  changedFiles,
  changesOpen = false,
  onToggleChanges,
  onHide,
}: {
  thread: Thread;
  controls: PullRequestControls;
  /** How many files the thread's worktree changed; 0 while that is not known. */
  changedFiles: number;
  /** Whether the changes view is what the pane shows now. */
  changesOpen?: boolean;
  onToggleChanges?: () => void;
  /** Puts the bar away for this thread; only offered while it has no pull request. */
  onHide?: () => void;
}) => {
  if (!hasPullRequestBar(thread, changedFiles)) return null;
  const pullRequest = pullRequestOf(thread);
  const landing = thread.status === "landing";
  const disabled = controls.busy !== null || landing;

  return (
    <section
      data-testid="pr-bar"
      data-state={pullRequest?.state ?? "none"}
      aria-label="Pull request"
      className="flex h-8 items-center gap-2 rounded-row border border-border bg-raised/60 pr-1 pl-3 text-meta max-sm:h-11"
    >
      {pullRequest || landing ? <StateSummary thread={thread} /> : <BranchField thread={thread} />}
      {changedFiles > 0 && onToggleChanges ? (
        <ChangesLink count={changedFiles} open={changesOpen} onToggle={onToggleChanges} />
      ) : null}
      {landing ? null : <Actions thread={thread} controls={controls} disabled={disabled} />}
      {!pullRequest && onHide ? <HideButton onHide={onHide} /> : null}
    </section>
  );
};

/**
 * Whether the thread has anything for the bar: a pull request (or one merging), or changed files
 * a pull request could be made from. One paused on a rate limit has not finished them yet.
 */
export const hasPullRequestBar = (thread: Thread, changedFiles: number): boolean =>
  pullRequestOf(thread) !== null ||
  thread.status === "landing" ||
  (changedFiles > 0 && thread.status !== "rate-limited");

/** "3 files changed": opens the changes in the pane, and closes them again. */
const ChangesLink = ({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) => (
  <button
    type="button"
    data-testid="pr-bar-changes"
    aria-pressed={open}
    title={open ? "Back to the conversation" : "Show the changes"}
    onClick={onToggle}
    className={cn(
      "shrink-0 rounded-row px-1 whitespace-nowrap underline-offset-2 transition-colors duration-[120ms] hover:text-text hover:underline max-sm:h-9",
      open ? "text-text underline" : "text-text-muted",
    )}
  >
    {count} {count === 1 ? "file" : "files"}
    <span className="max-sm:hidden"> changed</span>
  </button>
);

const HideButton = ({ onHide }: { onHide: () => void }) => (
  <Button
    type="button"
    size="icon-sm"
    variant="ghost"
    data-testid="pr-bar-hide"
    aria-label="Hide pull request bar"
    title="Hide this bar for this thread"
    onClick={onHide}
    className="size-6 shrink-0 max-sm:size-9 [&_svg]:size-3.5"
  >
    <XIcon />
  </Button>
);

/** The branch, read-only: it is what a pull request would be made from. */
const BranchField = ({ thread }: { thread: Thread }) => (
  <p
    data-testid="thread-branch"
    title={thread.branch ?? "No branch yet"}
    className="flex min-w-0 flex-1 items-center gap-1.5 text-text-muted"
  >
    <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
    <span className="truncate">{thread.branch ?? "No branch yet"}</span>
  </p>
);

const SUMMARY_CLASS = "flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap text-text-muted";

const StateSummary = ({ thread }: { thread: Thread }) => {
  const pullRequest = pullRequestOf(thread);
  if (thread.status === "landing") {
    return (
      <p data-testid="pr-bar-summary" className={SUMMARY_CLASS}>
        <Spinner className="size-3.5" />
        Merging
        {pullRequest ? (
          <PullRequestChip pullRequest={pullRequest} testId="pr-bar-chip" prefix="PR " />
        ) : null}
      </p>
    );
  }
  if (!pullRequest) return null;
  return (
    <p data-testid="pr-bar-summary" title={SUMMARY[pullRequest.state]} className={SUMMARY_CLASS}>
      <PullRequestChip
        pullRequest={pullRequest}
        testId="pr-bar-chip"
        prefix="PR "
        className="h-5 shrink-0"
      />
      {pullRequest.state === "open" ? null : (
        <span data-testid="pr-bar-state" className={cn("shrink-0", STATE_TONE[pullRequest.state])}>
          {STATE_LABEL[pullRequest.state]}
        </span>
      )}
      {pullRequest.state === "open" && pullRequest.checks ? (
        <span data-testid="pr-bar-checks" className="truncate">
          {checksLabel(pullRequest.checks)}
        </span>
      ) : null}
    </p>
  );
};

const STATE_LABEL = { merged: "Merged", closed: "Closed" } as const;

const STATE_TONE = { merged: "text-merged", closed: "text-text-subtle" } as const;

const SUMMARY = {
  open: "Open on GitHub.",
  merged: "Merged. The thread’s worktree and branch were removed.",
  closed: "Closed without merging. Further work belongs in a new thread.",
} as const;

const Actions = ({
  thread,
  controls,
  disabled,
}: {
  thread: Thread;
  controls: PullRequestControls;
  disabled: boolean;
}) => {
  const pullRequest = pullRequestOf(thread);
  if (!pullRequest) return <OpenButton controls={controls} disabled={disabled} />;
  if (pullRequest.state === "merged") return null;
  return (
    <>
      <SyncButton controls={controls} disabled={disabled} />
      {pullRequest.state === "open" ? (
        <MergeButton controls={controls} disabled={disabled} />
      ) : null}
    </>
  );
};

const HEADLINE: Record<PullRequestProblem["op"], string> = {
  open: "The pull request was not opened.",
  merge: "The pull request was not merged.",
  sync: "The pull request was not synced.",
};

/** What the host answered when it refused, in its own sentence and with its code, plus the one step that fixes the two refusals that have one. */
export const PullRequestProblemNotice = ({ controls }: { controls: PullRequestControls }) => {
  const { problem } = controls;
  return problem ? <Problem problem={problem} controls={controls} /> : null;
};

const Problem = ({
  problem,
  controls,
}: {
  problem: PullRequestProblem;
  controls: PullRequestControls;
}) => (
  <div
    role="alert"
    data-testid="pr-error"
    data-code={problem.code}
    className="mb-2 flex items-start gap-3 rounded-card border border-blocked/30 bg-blocked/5 px-3.5 py-2.5"
  >
    <div className="min-w-0 flex-1 text-meta">
      <p className="text-text">
        <span className="font-medium">{HEADLINE[problem.op]}</span>{" "}
        <span data-testid="pr-error-message" className="text-text-muted">
          {problem.message}
        </span>
      </p>
      <p data-testid="pr-error-code" className="mt-0.5 text-xs text-text-subtle">
        {problem.code}
      </p>
      <ProblemAction problem={problem} controls={controls} />
    </div>
    <button
      type="button"
      data-testid="pr-error-dismiss"
      aria-label="Dismiss"
      onClick={controls.dismiss}
      className="grid size-6 shrink-0 place-items-center rounded-row text-text-subtle hover:bg-hover hover:text-text"
    >
      <XIcon className="size-3.5" />
    </button>
  </div>
);

// The host names the step in its message; these two codes have a button that takes it.
const ProblemAction = ({
  problem,
  controls,
}: {
  problem: PullRequestProblem;
  controls: PullRequestControls;
}) => {
  if (problem.code === "UNPUBLISHED_WORK") {
    return (
      <Button
        type="button"
        size="xs"
        variant="outline"
        data-testid="pr-push-latest"
        disabled={controls.busy !== null}
        onClick={() => void controls.open()}
        className="mt-2"
      >
        Push the latest changes
      </Button>
    );
  }
  if (problem.code === "PULL_REQUEST_MERGED") {
    return (
      <Button
        type="button"
        size="xs"
        variant="outline"
        data-testid="pr-sync-after-error"
        disabled={controls.busy !== null}
        onClick={() => void controls.sync()}
        className="mt-2"
      >
        Sync with GitHub
      </Button>
    );
  }
  return null;
};
