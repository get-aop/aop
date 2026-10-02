import type {
  PullRequestMergeBlocker,
  PullRequestMergeMethod,
  PullRequestViewDetail,
} from "@aop/common";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  LockIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { useLocalStorage } from "../../hooks/use-local-storage";
import { CheckStatusIcon } from "./bits";
import { CheckList } from "./ChecksTab";
import { MERGE_LABEL, type PullRequestActions } from "./use-pull-request-actions";

/**
 * GitHub's merge box: what the checks add up to (with the list), whether the branch conflicts,
 * every reason the merge is blocked, and the merge button with its method. A blocked merge is
 * shown as blocked and why; AOP has no way to force one past the rules.
 */
export const MergeBox = ({
  detail,
  actions,
}: {
  detail: PullRequestViewDetail;
  actions: PullRequestActions;
}) => {
  if (detail.state === "merged") {
    return (
      <Box testId="pr-merge-box" status="merged">
        <Row icon={<Badge tone="bg-merged"><GitMergeIcon /></Badge>} title="Pull request successfully merged and closed">
          The <code className="font-mono text-[12.5px]">{detail.headRefName}</code> branch was merged into{" "}
          <code className="font-mono text-[12.5px]">{detail.baseRefName}</code>.
        </Row>
      </Box>
    );
  }
  if (detail.state === "closed") {
    return (
      <Box testId="pr-merge-box" status="closed">
        <Row icon={<Badge tone="bg-blocked"><GitPullRequestClosedIcon /></Badge>} title="Closed with unmerged commits">
          This pull request is closed.
        </Row>
        {actions.canWrite ? (
          <div className="border-t border-border px-4 py-3">
            <Button variant="secondary" size="sm" data-testid="pr-reopen" disabled={actions.pending !== null} onClick={() => void actions.setOpen(true)}>
              {actions.pending === "reopen" ? "Reopening…" : "Reopen pull request"}
            </Button>
          </div>
        ) : null}
      </Box>
    );
  }
  return (
    <Box testId="pr-merge-box" status={detail.merge.status}>
      <ChecksSection detail={detail} />
      <ConflictsSection conflicts={detail.merge.conflicts} />
      <BlockersSection blockers={detail.merge.blockers.filter((blocker) => blocker.kind !== "conflicts")} />
      <WarningsSection warnings={detail.merge.warnings} />
      <MergeAction detail={detail} actions={actions} />
    </Box>
  );
};

const Box = ({ testId, status, children }: { testId: string; status: string; children: ReactNode }) => (
  <section
    data-testid={testId}
    data-status={status}
    aria-label="Merge"
    className={cn(
      "overflow-hidden rounded-card border",
      status === "ready" ? "border-ok/40" : status === "merged" ? "border-merged/40" : "border-border-strong",
    )}
  >
    {children}
  </section>
);

const Row = ({ icon, title, children, aside }: { icon: ReactNode; title: string; children?: ReactNode; aside?: ReactNode }) => (
  <div className="flex items-start gap-3 px-4 py-3">
    {icon}
    <div className="min-w-0 flex-1">
      <p className="text-body font-semibold text-text">{title}</p>
      {children ? <div className="text-meta text-text-muted">{children}</div> : null}
    </div>
    {aside}
  </div>
);

const Badge = ({ tone, children }: { tone: string; children: ReactNode }) => (
  <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-white [&_svg]:size-4", tone)}>
    {children}
  </span>
);

const CHECKS_TITLE: Record<PullRequestViewDetail["checks"]["state"], string> = {
  success: "All checks have passed",
  failure: "Some checks were not successful",
  pending: "Some checks haven't completed yet",
  none: "No checks reported",
};

const ChecksSection = ({ detail }: { detail: PullRequestViewDetail }) => {
  const { checks } = detail;
  // Open by default only when something needs a look.
  const [open, setOpen] = useState(checks.state === "failure" || checks.state === "pending");
  const status = checks.state === "pending" ? "in_progress" : checks.state === "none" ? "neutral" : checks.state;
  const counts = [
    checks.failing && `${checks.failing} failing`,
    checks.pending && `${checks.pending} in progress`,
    checks.skipped && `${checks.skipped} skipped`,
    checks.successful && `${checks.successful} successful`,
  ].filter(Boolean);
  return (
    <div data-testid="pr-merge-checks" data-state={checks.state} className="border-b border-border">
      <Row
        icon={<span className="grid size-8 place-items-center"><CheckStatusIcon status={status} className="size-6" /></span>}
        title={CHECKS_TITLE[checks.state]}
        aside={
          checks.total > 0 ? (
            <Button variant="ghost" size="icon-sm" aria-expanded={open} aria-label={open ? "Hide the checks" : "Show the checks"} data-testid="pr-merge-checks-toggle" onClick={() => setOpen(!open)}>
              <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
            </Button>
          ) : null
        }
      >
        {checks.total > 0 ? `${counts.join(", ")} checks` : "This commit has no checks."}
      </Row>
      {open && checks.total > 0 ? (
        <div className="max-h-72 overflow-auto border-t border-border px-2 py-1">
          <CheckList items={checks.items} compact />
        </div>
      ) : null}
    </div>
  );
};

const ConflictsSection = ({ conflicts }: { conflicts: PullRequestViewDetail["merge"]["conflicts"] }) => {
  if (conflicts === "unknown") return null;
  const clean = conflicts === "none";
  return (
    <div data-testid="pr-merge-conflicts" data-conflicts={conflicts} className="border-b border-border">
      <Row
        icon={<Badge tone={clean ? "bg-ok" : "bg-blocked"}>{clean ? <CheckIcon /> : <XIcon />}</Badge>}
        title={clean ? "No conflicts with base branch" : "This branch has conflicts that must be resolved"}
      >
        {clean ? "Merging can be performed automatically." : "Resolve them on the branch (or on GitHub) and push."}
      </Row>
    </div>
  );
};

const BlockersSection = ({ blockers }: { blockers: PullRequestMergeBlocker[] }) =>
  blockers.length === 0 ? null : (
    <div data-testid="pr-merge-blockers" className="border-b border-border">
      <Row icon={<Badge tone="bg-blocked"><LockIcon /></Badge>} title="Merging is blocked">
        <ul className="mt-1 flex flex-col gap-1.5">
          {blockers.map((blocker) => (
            <li key={blocker.kind} data-testid="pr-merge-blocker" data-kind={blocker.kind}>
              <span className="font-medium text-text">{blocker.title}</span>
              {blocker.detail ? <span className="block">{blocker.detail}</span> : null}
            </li>
          ))}
        </ul>
      </Row>
    </div>
  );

const WarningsSection = ({ warnings }: { warnings: string[] }) =>
  warnings.length === 0 ? null : (
    <div data-testid="pr-merge-warnings" className="border-b border-border">
      <Row icon={<Badge tone="bg-waiting"><AlertTriangleIcon /></Badge>} title="Checks that are not required">
        <ul className="mt-1 flex flex-col gap-1">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </Row>
    </div>
  );

const MergeAction = ({ detail, actions }: { detail: PullRequestViewDetail; actions: PullRequestActions }) => {
  const { methods, status } = detail.merge;
  const [preferred, setPreferred] = useLocalStorage<PullRequestMergeMethod>("aop:pr-view:merge-method", "squash");
  const method = methods.includes(preferred) ? preferred : (methods[0] ?? "squash");
  if (!actions.canWrite) {
    return (
      <p data-testid="pr-merge-read-only" className="px-4 py-3 text-meta text-text-subtle">
        {detail.viewer.readOnlyReason ?? "This client can only read this pull request."}
      </p>
    );
  }
  const disabled = status !== "ready" || actions.pending !== null || methods.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex">
        <Button
          data-testid="pr-merge"
          size="sm"
          disabled={disabled}
          onClick={() => void actions.merge(method)}
          className={cn("rounded-r-none", status === "ready" && "bg-ok text-white hover:bg-ok/90")}
        >
          {actions.pending === "merge" ? "Merging…" : MERGE_LABEL[method]}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="pr-merge-method"
              size="sm"
              aria-label="Choose how to merge"
              disabled={actions.pending !== null || methods.length < 2}
              className={cn("rounded-l-none border-l border-black/20 px-2", status === "ready" && "bg-ok text-white hover:bg-ok/90")}
            >
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={method} onValueChange={(value) => setPreferred(value as PullRequestMergeMethod)}>
              {methods.map((option) => (
                <DropdownMenuRadioItem key={option} value={option} data-testid={`pr-merge-method-${option}`}>
                  {MERGE_LABEL[option]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span className="text-meta text-text-subtle">
        {status === "ready" ? "Merges on GitHub as the host's account." : "Fix what blocks the merge first; AOP never bypasses the rules."}
      </span>
      <DraftLink detail={detail} actions={actions} />
    </div>
  );
};

const DraftLink = ({ detail, actions }: { detail: PullRequestViewDetail; actions: PullRequestActions }) => (
  <span className="ml-auto text-meta text-text-subtle">
    {detail.isDraft ? (
      <Button size="sm" variant="secondary" data-testid="pr-ready" disabled={actions.pending !== null} onClick={() => void actions.setDraft(false)}>
        {actions.pending === "ready" ? "Marking ready…" : "Ready for review"}
      </Button>
    ) : (
      <>
        Still in progress?{" "}
        <button type="button" data-testid="pr-convert-draft" disabled={actions.pending !== null} onClick={() => void actions.setDraft(true)} className="underline hover:text-text">
          Convert to draft
        </button>
      </>
    )}
  </span>
);
