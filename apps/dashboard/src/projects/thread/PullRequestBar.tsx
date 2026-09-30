import type { Thread } from "@aop/common";
import {
  ChevronDownIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Spinner } from "@/ui/spinner";
import type { MergeMethod } from "../../api/threads";
import { checksLabel, PullRequestChip } from "../PullRequestChip";
import { pullRequestOf } from "../selectors";
import type { PullRequestControls, PullRequestProblem } from "./use-pull-request";

const MERGE_METHODS: { method: MergeMethod; label: string }[] = [
  { method: "squash", label: "Squash and merge" },
  { method: "merge", label: "Create a merge commit" },
  { method: "rebase", label: "Rebase and merge" },
];

/**
 * The thread's pull request in one line: none yet (open one), open (sync it, merge it), merged
 * or closed (what became of it). It sits beside the pane's tabs because it is how the work
 * leaves the thread. What the host refuses is shown by `PullRequestProblemNotice`, below.
 */
export const PullRequestBar = ({
  thread,
  controls,
}: {
  thread: Thread;
  controls: PullRequestControls;
}) => {
  const pullRequest = pullRequestOf(thread);
  const landing = thread.status === "landing";
  const disabled = controls.busy !== null || landing;

  return (
    <section
      data-testid="pr-bar"
      data-state={pullRequest?.state ?? "none"}
      aria-label="Pull request"
      className="flex items-center gap-2"
    >
      <StateSummary thread={thread} />
      {landing ? null : <Actions thread={thread} controls={controls} disabled={disabled} />}
    </section>
  );
};

const SUMMARY_CLASS = "flex items-center gap-1.5 text-[12.5px] text-text-muted";

const StateSummary = ({ thread }: { thread: Thread }) => {
  const pullRequest = pullRequestOf(thread);
  if (thread.status === "landing") {
    return (
      <p data-testid="pr-bar-summary" className={SUMMARY_CLASS}>
        <Spinner className="size-3.5" />
        Merging
        {pullRequest ? <PullRequestChip pullRequest={pullRequest} testId="pr-bar-chip" /> : null}
      </p>
    );
  }
  if (!pullRequest) {
    return (
      <p
        data-testid="pr-bar-summary"
        title="Opening one commits the thread’s work and pushes its branch."
        className={SUMMARY_CLASS}
      >
        <GitPullRequestIcon aria-hidden="true" className="size-3.5 text-text-subtle" />
        No pull request
      </p>
    );
  }
  return (
    <p data-testid="pr-bar-summary" title={SUMMARY[pullRequest.state]} className={SUMMARY_CLASS}>
      <PullRequestChip pullRequest={pullRequest} testId="pr-bar-chip" />
      <span data-testid="pr-bar-state" className={STATE_TONE[pullRequest.state]}>
        {STATE_LABEL[pullRequest.state]}
      </span>
      {pullRequest.state === "open" && pullRequest.checks ? (
        <span data-testid="pr-bar-checks" className="text-text-subtle">
          · {checksLabel(pullRequest.checks)}
        </span>
      ) : null}
    </p>
  );
};

const STATE_LABEL = { open: "Open", merged: "Merged", closed: "Closed" } as const;

const STATE_TONE = { open: "text-ok", merged: "text-merged", closed: "text-text-subtle" } as const;

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
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid="pr-sync"
        disabled={disabled}
        onClick={() => void controls.sync()}
      >
        {controls.busy === "sync" ? <Spinner className="size-3.5" /> : <RefreshCwIcon />}
        {controls.busy === "sync" ? "Syncing…" : "Sync"}
      </Button>
      {pullRequest.state === "open" ? (
        <MergeButton controls={controls} disabled={disabled} />
      ) : null}
    </>
  );
};

const OpenButton = ({
  controls,
  disabled,
}: {
  controls: PullRequestControls;
  disabled: boolean;
}) => (
  <div className="flex items-center">
    <Button
      type="button"
      size="sm"
      data-testid="pr-open"
      disabled={disabled}
      onClick={() => void controls.open()}
      className="rounded-r-none"
    >
      {controls.busy === "open" ? <Spinner className="size-3.5" /> : <GitPullRequestIcon />}
      {controls.busy === "open" ? "Opening…" : "Open pull request"}
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          data-testid="pr-open-menu"
          aria-label="More ways to open"
          disabled={disabled}
          className="rounded-l-none border-l border-canvas/30 px-1.5"
        >
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid="pr-open-draft"
          onSelect={() => void controls.open({ draft: true })}
        >
          Open as draft
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

const MergeButton = ({
  controls,
  disabled,
}: {
  controls: PullRequestControls;
  disabled: boolean;
}) => {
  const [method, setMethod] = useState<MergeMethod>("squash");
  return (
    <div className="flex items-center">
      <Button
        type="button"
        size="sm"
        data-testid="pr-merge"
        data-method={method}
        disabled={disabled}
        onClick={() => void controls.merge(method)}
        className="rounded-r-none"
      >
        {controls.busy === "merge" ? <Spinner className="size-3.5" /> : <GitMergeIcon />}
        {controls.busy === "merge" ? "Merging…" : "Merge"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            data-testid="pr-merge-menu"
            aria-label="Merge method"
            disabled={disabled}
            className="rounded-l-none border-l border-canvas/30 px-1.5"
          >
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="pr-merge-methods">
          <DropdownMenuRadioGroup
            value={method}
            onValueChange={(value) => setMethod(value as MergeMethod)}
          >
            {MERGE_METHODS.map(({ method: value, label }) => (
              <DropdownMenuRadioItem key={value} value={value} data-testid={`pr-merge-${value}`}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
    className="mx-6 mt-3 flex items-start gap-3 rounded-card border border-blocked/30 bg-blocked/5 px-3.5 py-2.5"
  >
    <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
      <p className="text-text">
        <span className="font-medium">{HEADLINE[problem.op]}</span>{" "}
        <span data-testid="pr-error-message" className="text-text-muted">
          {problem.message}
        </span>
      </p>
      <p data-testid="pr-error-code" className="mt-0.5 text-[11.5px] text-text-subtle">
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
