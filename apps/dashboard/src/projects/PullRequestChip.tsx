import type { PullRequestRef } from "@aop/common";
import { GitPullRequestIcon } from "lucide-react";
import { cn } from "@/lib/cn";

const TONE: Record<PullRequestRef["state"], string> = {
  open: "border-ok/30 bg-ok/10 text-ok",
  merged: "border-merged/30 bg-merged/10 text-merged",
  closed: "border-border-strong bg-raised text-text-muted",
};

/** "#4821", coloured by the pull request's state; it opens the pull request in a new tab. */
export const PullRequestChip = ({
  pullRequest,
  testId = "pr-chip",
  className,
}: {
  pullRequest: PullRequestRef;
  testId?: string;
  className?: string;
}) => (
  <a
    href={pullRequest.url}
    target="_blank"
    rel="noreferrer noopener"
    data-testid={testId}
    data-state={pullRequest.state}
    className={cn(
      "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 align-middle text-[11.5px] font-medium",
      TONE[pullRequest.state],
      className,
    )}
  >
    <GitPullRequestIcon className="size-3" />#{pullRequest.number}
  </a>
);
