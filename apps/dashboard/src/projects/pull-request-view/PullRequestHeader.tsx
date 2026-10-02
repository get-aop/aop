import type { PullRequestViewDetail } from "@aop/common";
import {
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";
import { AskCoordinator } from "./AskCoordinator";
import { CheckStatusIcon, plural, StateBadge } from "./bits";
import type { PullRequestActions } from "./use-pull-request-actions";

/**
 * GitHub's pull request header: the title (the host owner can edit it) and number, the state,
 * "who wants to merge how many commits into what from where" with a copy button for the branch,
 * and what the checks add up to. Refresh, Ask the coordinator and Open on GitHub sit at its end.
 */
export const PullRequestHeader = ({
  detail,
  actions,
  refreshing,
  onRefresh,
  onAsk,
  compact = false,
}: {
  detail: PullRequestViewDetail;
  actions: PullRequestActions;
  refreshing: boolean;
  onRefresh: () => void;
  onAsk: (question: string) => Promise<boolean>;
  /** One line (state, title, buttons), so the Files tab keeps its height for the diff. */
  compact?: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const buttons = (
    <HeaderButtons
      detail={detail}
      actions={actions}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onAsk={onAsk}
    />
  );
  if (compact) {
    return (
      <header
        data-testid="pr-header"
        data-compact="true"
        className="flex items-center gap-3 border-b border-border pb-3"
      >
        <StateBadge detail={detail} />
        <h1
          data-testid="pr-title"
          className="min-w-0 flex-1 truncate text-title text-text"
          title={detail.title}
        >
          {detail.title} <span className="text-text-subtle">#{detail.number}</span>
        </h1>
        {buttons}
      </header>
    );
  }
  return (
    <header data-testid="pr-header" className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {editing ? (
          <TitleEditor detail={detail} actions={actions} onDone={() => setEditing(false)} />
        ) : (
          <h1
            data-testid="pr-title"
            className="min-w-0 flex-[1_1_22rem] text-[1.375rem] leading-snug font-normal text-text"
          >
            <span className="break-words">{detail.title}</span>{" "}
            <span className="text-text-subtle">#{detail.number}</span>
            {actions.canWrite && detail.state !== "merged" ? (
              <button
                type="button"
                data-testid="pr-title-edit"
                aria-label="Edit the title"
                title="Edit the title"
                onClick={() => setEditing(true)}
                className="ml-2 inline-grid size-7 place-items-center rounded-row align-middle text-text-subtle hover:bg-hover hover:text-text"
              >
                <PencilIcon className="size-4" />
              </button>
            ) : null}
          </h1>
        )}
        {buttons}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-body text-text-muted">
        <StateBadge detail={detail} />
        <MergeSentence detail={detail} />
        <span className="ml-auto">
          <ChecksSummary detail={detail} />
        </span>
      </div>
    </header>
  );
};

const HeaderButtons = ({
  detail,
  actions,
  refreshing,
  onRefresh,
  onAsk,
}: {
  detail: PullRequestViewDetail;
  actions: PullRequestActions;
  refreshing: boolean;
  onRefresh: () => void;
  onAsk: (question: string) => Promise<boolean>;
}) => (
  <div className="ml-auto flex shrink-0 items-center gap-1.5">
    <Button
      variant="ghost"
      size="icon-sm"
      data-testid="pr-refresh"
      aria-label="Refresh from GitHub"
      title="Refresh from GitHub"
      disabled={refreshing}
      onClick={onRefresh}
    >
      <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
    </Button>
    <AskCoordinator detail={detail} onAsk={onAsk} />
    <Button variant="secondary" size="sm" asChild>
      <a href={detail.url} target="_blank" rel="noreferrer noopener" data-testid="pr-open-github">
        <ExternalLinkIcon />
        <span className="hidden @5xl:inline">Open on GitHub</span>
        <span className="@5xl:hidden">GitHub</span>
      </a>
    </Button>
    <StateMenu detail={detail} actions={actions} />
  </div>
);

const MergeSentence = ({ detail }: { detail: PullRequestViewDetail }) => {
  const verb = detail.state === "merged" ? "merged" : "wants to merge";
  return (
    <span data-testid="pr-merge-sentence" className="min-w-0">
      <span className="font-medium text-text">{detail.author?.login ?? "Someone"}</span> {verb}{" "}
      {plural(detail.commitCount, "commit")} into <BranchName name={detail.baseRefName} /> from{" "}
      <span className="inline-flex max-w-full items-center align-middle">
        <BranchName name={detail.headLabel} />
        <CopyBranch branch={detail.headRefName} />
      </span>
    </span>
  );
};

const BranchName = ({ name }: { name: string }) => (
  <code className="min-w-0 truncate rounded-md bg-running/10 px-1.5 py-0.5 font-mono text-[12.5px] text-running">
    {name}
  </code>
);

const CopyBranch = ({ branch }: { branch: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid="pr-copy-branch"
      aria-label={copied ? "Copied" : "Copy the head branch name"}
      title={copied ? "Copied" : "Copy the head branch name"}
      onClick={() => {
        void navigator.clipboard?.writeText(branch).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="ml-1 inline-grid size-6 shrink-0 place-items-center rounded-row align-middle text-text-subtle hover:bg-hover hover:text-text"
    >
      {copied ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
};

/** "All checks have passed", "2 failing, 1 in progress", or nothing for a commit with no checks. */
export const ChecksSummary = ({ detail }: { detail: Pick<PullRequestViewDetail, "checks"> }) => {
  const { checks } = detail;
  if (checks.state === "none") return null;
  const status = checks.state === "pending" ? "in_progress" : checks.state;
  return (
    <span
      data-testid="pr-checks-summary"
      data-state={checks.state}
      className="inline-flex items-center gap-1.5 text-meta"
    >
      <CheckStatusIcon status={status} />
      {checksSentence(checks)}
    </span>
  );
};

export const checksSentence = (checks: PullRequestViewDetail["checks"]): string =>
  checks.state === "success"
    ? `All checks have passed (${checkCounts(checks)})`
    : checkCounts(checks);

/** "2 failing, 1 in progress, 5 successful checks": what the checks add up to, without a verdict. */
export const checkCounts = (checks: PullRequestViewDetail["checks"]): string => {
  const queued = checks.items.filter((check) => check.status === "queued").length;
  const running = checks.pending - queued;
  const parts = [
    checks.failing > 0 ? `${checks.failing} failing` : null,
    running > 0 ? `${running} in progress` : null,
    queued > 0 ? `${queued} queued` : null,
    checks.successful > 0 ? `${checks.successful} successful` : null,
    checks.skipped > 0 ? `${checks.skipped} skipped` : null,
  ].filter(Boolean);
  return `${parts.join(", ")} ${checks.total === 1 ? "check" : "checks"}`;
};

const TitleEditor = ({
  detail,
  actions,
  onDone,
}: {
  detail: PullRequestViewDetail;
  actions: PullRequestActions;
  onDone: () => void;
}) => {
  const [title, setTitle] = useState(detail.title);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const next = title.trim();
    if (!next || next === detail.title || (await actions.rename(next))) onDone();
  };
  return (
    <form
      onSubmit={save}
      className="flex min-w-0 flex-1 items-center gap-2"
      data-testid="pr-title-form"
    >
      <Input
        autoFocus
        aria-label="Title"
        data-testid="pr-title-input"
        value={title}
        maxLength={256}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // Escape cancels the edit; it must not also close the whole view.
            event.preventDefault();
            onDone();
          }
        }}
        className="h-9 flex-1 text-title"
      />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        disabled={actions.pending === "rename" || !title.trim()}
      >
        {actions.pending === "rename" ? "Saving…" : "Save"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
};

/** Close or reopen, and draft or ready: the host owner's state changes, out of the way in a menu. */
const StateMenu = ({
  detail,
  actions,
}: {
  detail: PullRequestViewDetail;
  actions: PullRequestActions;
}) => {
  if (!actions.canWrite || detail.state === "merged") return null;
  const open = detail.state === "open";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="pr-state-menu"
          aria-label="More actions"
          disabled={actions.pending !== null}
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {open ? (
          <DropdownMenuItem
            data-testid="pr-toggle-draft"
            onSelect={() => void actions.setDraft(!detail.isDraft)}
          >
            {detail.isDraft ? "Ready for review" : "Convert to draft"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          data-testid="pr-toggle-open"
          variant={open ? "destructive" : undefined}
          onSelect={() => void actions.setOpen(!open)}
        >
          {open ? "Close pull request" : "Reopen pull request"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
