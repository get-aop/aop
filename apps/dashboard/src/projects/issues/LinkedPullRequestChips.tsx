import type { LinkedPullRequest } from "@aop/common";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { openPullRequestView } from "../pull-request-view/open-pull-request-view";

const STATE: Record<LinkedPullRequest["state"], { icon: LucideIcon; tone: string; label: string }> =
  {
    open: { icon: GitPullRequestIcon, tone: "border-ok/30 bg-ok/10 text-ok", label: "Open" },
    draft: {
      icon: GitPullRequestDraftIcon,
      tone: "border-border-strong bg-raised text-text-muted",
      label: "Draft",
    },
    merged: {
      icon: GitMergeIcon,
      tone: "border-merged/30 bg-merged/10 text-merged",
      label: "Merged",
    },
    closed: {
      icon: GitPullRequestClosedIcon,
      tone: "border-blocked/30 bg-blocked/10 text-blocked",
      label: "Closed",
    },
  };

const CHECKS: Record<NonNullable<LinkedPullRequest["checks"]>, { dot: string; label: string }> = {
  passing: { dot: "bg-ok", label: "checks passing" },
  failing: { dot: "bg-blocked", label: "checks failing" },
  pending: { dot: "bg-waiting", label: "checks running" },
};

/** What a chip says to a screen reader and in its tooltip. */
export const linkedPullRequestLabel = (pr: LinkedPullRequest): string => {
  const checks =
    pr.checks && (pr.state === "open" || pr.state === "draft") ? CHECKS[pr.checks] : null;
  return [
    `${STATE[pr.state].label} pull request ${pr.nameWithOwner}#${pr.number}: ${pr.title}`,
    checks?.label,
  ]
    .filter(Boolean)
    .join(", ");
};

/**
 * The pull requests linked to an issue, one chip each, coloured by state, with a dot for the
 * checks of one still open. A chip of a pull request in one of the project's repositories opens
 * it in the PR View; one elsewhere opens on GitHub. Cmd/Ctrl-click always opens GitHub.
 */
export const LinkedPullRequestChips = ({
  projectId,
  pullRequests,
}: {
  projectId: string;
  pullRequests: readonly LinkedPullRequest[];
}) =>
  pullRequests.length === 0 ? null : (
    <span data-testid="issue-pull-requests" className="contents">
      {pullRequests.map((pr) => (
        <PullRequestChip key={`${pr.nameWithOwner}#${pr.number}`} projectId={projectId} pr={pr} />
      ))}
    </span>
  );

const PullRequestChip = ({ projectId, pr }: { projectId: string; pr: LinkedPullRequest }) => {
  const { icon: Icon, tone } = STATE[pr.state];
  const checks =
    pr.checks && (pr.state === "open" || pr.state === "draft") ? CHECKS[pr.checks] : null;
  const label = linkedPullRequestLabel(pr);
  const { repoId } = pr;
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer noopener"
      data-testid="issue-pr-chip"
      data-state={pr.state}
      data-checks={checks ? pr.checks : undefined}
      data-in-project={repoId !== null}
      aria-label={label}
      title={label}
      onClick={(event) => {
        if (repoId === null || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        openPullRequestView({ projectId, repoId, number: pr.number });
      }}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11.5px] font-medium leading-none tabular-nums transition-colors duration-[120ms] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-running",
        tone,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />#{pr.number}
      {checks ? (
        <span
          aria-hidden="true"
          data-testid="issue-pr-checks"
          className={cn("size-1.5 rounded-full", checks.dot)}
        />
      ) : null}
    </a>
  );
};
