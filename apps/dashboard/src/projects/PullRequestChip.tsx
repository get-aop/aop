import type { PullRequestChecks, PullRequestRef } from "@aop/common";
import { GitPullRequestIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { openInView, usePullRequestLinks } from "./pull-request-view/pull-request-links";

const TONE: Record<PullRequestRef["state"], string> = {
  open: "border-ok/30 bg-ok/10 text-ok",
  merged: "border-merged/30 bg-merged/10 text-merged",
  closed: "border-border-strong bg-raised text-text-muted",
};

const CHECKS_DOT: Record<PullRequestChecks["state"], string> = {
  pending: "bg-waiting",
  success: "bg-ok",
  failure: "bg-blocked",
};

/** What the checks of an open pull request add up to, in words: "2 checks failing", "1 check running", "All checks passed". */
export const checksLabel = ({ state, failing, pending }: PullRequestChecks): string => {
  if (state === "failure") return failing === 1 ? "1 check failing" : `${failing} checks failing`;
  if (state === "pending") return pending === 1 ? "1 check running" : `${pending} checks running`;
  return "All checks passed";
};

/**
 * "#4821", coloured by the pull request's state. A click shows the pull request in the PR View
 * when it is one of the project's (`repoId` names the repository when the caller knows it); a
 * modified click, or a pull request of elsewhere, opens it on GitHub in a new tab. An open
 * pull request whose checks the host has read also shows a dot for what they add up to: once it has
 * merged or closed, the last reading is history and the chip is only its state.
 */
export const PullRequestChip = ({
  pullRequest,
  testId = "pr-chip",
  prefix = "",
  repoId,
  className,
}: {
  pullRequest: PullRequestRef;
  /** The project repository the pull request is in (a thread's `repoId`), when known. */
  repoId?: string | null;
  testId?: string;
  /** Written before the number: "PR " where nothing else says it is a pull request. */
  prefix?: string;
  className?: string;
}) => {
  const checks = pullRequest.state === "open" ? pullRequest.checks : undefined;
  const target = usePullRequestLinks()?.targetOf(pullRequest.url, repoId) ?? null;
  return (
    <a
      href={pullRequest.url}
      target="_blank"
      rel="noreferrer noopener"
      data-testid={testId}
      data-state={pullRequest.state}
      data-checks={checks?.state}
      data-opens={target ? "view" : "github"}
      title={chipTitle(checks ? checksLabel(checks) : null, target !== null)}
      onClick={openInView(target)}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md border px-2 align-middle text-meta font-medium",
        TONE[pullRequest.state],
        className,
      )}
    >
      <GitPullRequestIcon className="size-3" />
      {prefix}#{pullRequest.number}
      {checks ? (
        <span
          role="img"
          aria-label={checksLabel(checks)}
          data-testid={`${testId}-checks`}
          className={cn("size-1.5 rounded-full", CHECKS_DOT[checks.state])}
        />
      ) : null}
    </a>
  );
};

const chipTitle = (checks: string | null, inView: boolean): string | undefined => {
  const where = inView ? "Show the pull request here (⌘-click opens GitHub)" : null;
  return [checks, where].filter(Boolean).join(" · ") || undefined;
};
