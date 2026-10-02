import type { PullRequestViewCheck, PullRequestViewDetail } from "@aop/common";
import { ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Ago, CheckStatusIcon, checkLabel } from "./bits";
import { checksSentence } from "./PullRequestHeader";

/** The Checks tab: every check of the head commit, failing first, each with a link to its logs. */
export const ChecksTab = ({ detail }: { detail: PullRequestViewDetail }) => {
  const { checks } = detail;
  if (checks.total === 0) {
    return (
      <EmptyTab testId="pr-checks-empty" title="No checks">
        GitHub reported no checks for the head commit{" "}
        <code className="font-mono">{detail.headSha.slice(0, 7)}</code>.
      </EmptyTab>
    );
  }
  return (
    <section data-testid="pr-checks-tab" className="flex flex-col gap-3">
      <p className="text-body text-text-muted">
        {checksSentence(checks)} on{" "}
        <code className="font-mono text-[12.5px]">{detail.headSha.slice(0, 7)}</code>
        {checks.pending > 0 ? " · updating while they run" : ""}
      </p>
      <div className="overflow-hidden rounded-card border border-border-strong">
        <CheckList items={checks.items} />
      </div>
    </section>
  );
};

/** Checks grouped as GitHub's merge box groups them: failing, then running, then the rest. */
export const CheckList = ({
  items,
  compact = false,
}: {
  items: PullRequestViewCheck[];
  compact?: boolean;
}) => (
  <ul data-testid="pr-check-list" className="flex flex-col divide-y divide-border">
    {items.map((check) => (
      <CheckRow key={`${check.workflow ?? ""}/${check.name}`} check={check} compact={compact} />
    ))}
  </ul>
);

const CheckRow = ({ check, compact }: { check: PullRequestViewCheck; compact: boolean }) => (
  <li
    data-testid="pr-check"
    data-status={check.status}
    data-required={check.required}
    className={cn(
      "flex min-w-0 items-center gap-2.5 text-meta",
      compact ? "px-2 py-1.5" : "px-4 py-2.5",
    )}
  >
    <CheckStatusIcon status={check.status} />
    <span className="min-w-0 flex-1 truncate">
      <span className="font-medium text-text">
        {check.workflow ? `${check.workflow} / ` : ""}
        {check.name}
      </span>{" "}
      <span className="text-text-subtle">
        {check.description ?? checkLabel(check.status)}
        {check.completedAt ? (
          <>
            {" · "}
            <Ago at={check.completedAt} />
          </>
        ) : check.startedAt && check.status === "in_progress" ? (
          <>
            {" · started "}
            <Ago at={check.startedAt} />
          </>
        ) : null}
      </span>
    </span>
    {check.required ? (
      <span className="shrink-0 rounded-full border border-border-strong px-2 py-0.5 text-[11px] text-text-muted">
        Required
      </span>
    ) : null}
    {check.url ? (
      <a
        href={check.url}
        target="_blank"
        rel="noreferrer noopener"
        data-testid="pr-check-details"
        className="inline-flex shrink-0 items-center gap-1 text-running hover:underline"
      >
        Details
        <ExternalLinkIcon className="size-3" aria-hidden="true" />
      </a>
    ) : null}
  </li>
);

export const EmptyTab = ({
  testId,
  title,
  className,
  children,
}: {
  testId: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <div
    data-testid={testId}
    className={cn(
      "flex flex-col items-center gap-1 rounded-card border border-dashed border-border-strong px-6 py-10 text-center",
      className,
    )}
  >
    <p className="text-body font-medium text-text">{title}</p>
    <p className="text-meta text-text-muted">{children}</p>
  </div>
);
