import type {
  GithubLabel,
  GithubUser,
  PullRequestChecks,
  PullRequestListItem,
  PullRequestListItemState,
  PullRequestReviewState,
} from "@aop/common";
import {
  CheckIcon,
  DotIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  type LucideIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Link, threadPath } from "../../shell/router";
import { checksLabel } from "../PullRequestChip";
import { formatAgo } from "../selectors";
import { GithubAvatar } from "./GithubAvatar";

const STATE: Record<PullRequestListItemState, { icon: LucideIcon; label: string; tone: string }> = {
  open: { icon: GitPullRequestIcon, label: "Open", tone: "text-ok" },
  draft: { icon: GitPullRequestDraftIcon, label: "Draft", tone: "text-text-muted" },
  merged: { icon: GitMergeIcon, label: "Merged", tone: "text-merged" },
  closed: { icon: GitPullRequestClosedIcon, label: "Closed", tone: "text-blocked" },
};

const REVIEW: Record<PullRequestReviewState, { label: string; tone: string }> = {
  approved: { label: "Approved", tone: "text-ok" },
  "changes-requested": { label: "Changes requested", tone: "text-blocked" },
  "review-required": { label: "Review required", tone: "text-text-muted" },
};

/**
 * One pull request of the list, laid out for a narrow panel. Its title is the button that opens
 * it in the PR View (stretched over the row, so the whole row opens it); the thread marker and
 * the checks sit above that and do their own thing.
 */
export const PullRequestRow = ({
  pull,
  projectId,
  threadTitle,
  selected,
  now,
  onOpen,
}: {
  pull: PullRequestListItem;
  projectId: string;
  /** The title of the AOP thread whose pull request this is, when it is one. */
  threadTitle: string | null;
  /** It is the one the PR View shows. */
  selected: boolean;
  now: number;
  onOpen: (pull: PullRequestListItem) => void;
}) => {
  const state = STATE[pull.state];
  const StateIcon = state.icon;
  return (
    <article
      data-testid="pr-row"
      data-repo={pull.repo}
      data-number={pull.number}
      data-state={pull.state}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group/pr relative flex gap-2.5 rounded-row border-l-2 py-2.5 pr-3 pl-2.5 transition-colors duration-[120ms]",
        selected ? "border-running bg-active" : "border-transparent hover:bg-hover",
      )}
    >
      <StateIcon
        aria-label={state.label}
        role="img"
        data-testid="pr-state-icon"
        className={cn("mt-[3px] size-4 shrink-0", state.tone)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            data-testid="pr-row-open"
            data-pr-row-button=""
            onClick={() => onOpen(pull)}
            className="line-clamp-2 min-w-0 flex-1 text-left text-body leading-snug font-medium text-text outline-none after:absolute after:inset-0 after:rounded-row after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-running"
          >
            {pull.title}
          </button>
          {pull.checks ? <ChecksIcon checks={pull.checks} /> : null}
        </div>
        <MetaLine pull={pull} now={now} />
        {pull.labels.length > 0 ? <Labels labels={pull.labels} /> : null}
        <FooterLine pull={pull} projectId={projectId} threadTitle={threadTitle} />
      </div>
    </article>
  );
};

/** "acme/shop #12 · ada · updated 3h ago · 4 comments". */
const MetaLine = ({ pull, now }: { pull: PullRequestListItem; now: number }) => (
  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-text-subtle">
    <span data-testid="pr-ref" className="min-w-0 truncate text-text-muted">
      {pull.repo} <span className="tabular-nums">#{pull.number}</span>
    </span>
    {pull.author ? (
      <>
        <Dot />
        <span data-testid="pr-author" className="inline-flex min-w-0 items-center gap-1">
          <GithubAvatar login={pull.author.login} avatarUrl={pull.author.avatarUrl} size={14} />
          <span className="truncate">{pull.author.login}</span>
        </span>
      </>
    ) : null}
    <Dot />
    <time
      data-testid="pr-updated"
      dateTime={pull.updatedAt}
      title={new Date(pull.updatedAt).toLocaleString()}
    >
      updated {formatAgo(pull.updatedAt, now)}
    </time>
    {pull.comments > 0 ? (
      <>
        <Dot />
        <span
          data-testid="pr-comments"
          title={`${pull.comments} ${pull.comments === 1 ? "comment" : "comments"}`}
          className="inline-flex items-center gap-0.5 tabular-nums"
        >
          <MessageSquareIcon aria-hidden="true" className="size-3" />
          {pull.comments}
          <span className="sr-only"> comments</span>
        </span>
      </>
    ) : null}
  </div>
);

const Dot = () => (
  <span aria-hidden="true" className="text-text-subtle/60">
    ·
  </span>
);

/** The branch it merges and where to, the review decision, who it is assigned to, and its thread. */
const FooterLine = ({
  pull,
  projectId,
  threadTitle,
}: {
  pull: PullRequestListItem;
  projectId: string;
  threadTitle: string | null;
}) => (
  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta">
    <span
      data-testid="pr-branches"
      title={`${pull.headRefName} into ${pull.baseRefName}`}
      className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-[11.5px] text-text-subtle"
    >
      <span className="truncate">{pull.headRefName}</span>
      <span aria-hidden="true">→</span>
      <span className="sr-only">into</span>
      <span className="shrink-0">{pull.baseRefName}</span>
    </span>
    {pull.review ? (
      <span data-testid="pr-review" data-review={pull.review} className={REVIEW[pull.review].tone}>
        {REVIEW[pull.review].label}
      </span>
    ) : null}
    {pull.assignees.length > 0 ? <Assignees assignees={pull.assignees} /> : null}
    {pull.threadId ? (
      <ThreadMarker projectId={projectId} threadId={pull.threadId} title={threadTitle} />
    ) : null}
  </div>
);

const ChecksIcon = ({ checks }: { checks: PullRequestChecks }) => {
  const { icon: Icon, tone } = CHECKS[checks.state];
  const label = checksTitle(checks);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="pr-checks"
      data-checks={checks.state}
      className={cn("relative z-10 mt-[3px] shrink-0", tone)}
    >
      <Icon
        aria-hidden="true"
        className="size-4"
        strokeWidth={checks.state === "pending" ? 6 : 2.5}
      />
    </span>
  );
};

const CHECKS: Record<PullRequestChecks["state"], { icon: LucideIcon; tone: string }> = {
  success: { icon: CheckIcon, tone: "text-ok" },
  failure: { icon: XIcon, tone: "text-blocked" },
  pending: { icon: DotIcon, tone: "text-waiting" },
};

// "2 checks failing · 5 passing", so a tooltip says more than the icon.
const checksTitle = (checks: PullRequestChecks): string => {
  const head = checksLabel(checks);
  const passing =
    checks.state !== "success" && checks.successful > 0 ? ` · ${checks.successful} passing` : "";
  return `${head}${passing}`;
};

const Labels = ({ labels }: { labels: readonly GithubLabel[] }) => (
  <div data-testid="pr-labels" className="flex min-w-0 flex-wrap gap-1">
    {labels.map((label) => (
      <span
        key={label.name}
        data-testid="pr-label"
        style={labelStyle(label.color)}
        className="inline-flex h-5 max-w-full items-center truncate rounded-full border px-2 text-[11.5px] leading-none font-medium"
      >
        <span className="truncate">{label.name}</span>
      </span>
    ))}
  </div>
);

const Assignees = ({ assignees }: { assignees: readonly GithubUser[] }) => (
  <span
    data-testid="pr-assignees"
    title={`Assigned to ${assignees.map((user) => user.login).join(", ")}`}
    className="inline-flex items-center -space-x-1"
  >
    {assignees.slice(0, 3).map((user) => (
      <GithubAvatar
        key={user.login}
        login={user.login}
        avatarUrl={user.avatarUrl}
        size={16}
        className="ring-2 ring-surface"
      />
    ))}
    {assignees.length > 3 ? (
      <span className="pl-1.5 text-xs text-text-subtle">+{assignees.length - 3}</span>
    ) : null}
    <span className="sr-only">Assigned to {assignees.map((user) => user.login).join(", ")}</span>
  </span>
);

/** "Thread": the AOP thread whose pull request this is; it opens that thread in the panel. */
const ThreadMarker = ({
  projectId,
  threadId,
  title,
}: {
  projectId: string;
  threadId: string;
  title: string | null;
}) => (
  <Link
    to={threadPath(projectId, threadId)}
    data-testid="pr-thread-link"
    title={title ? `Open thread: ${title}` : "Open its thread"}
    className="relative z-10 inline-flex h-5 items-center gap-1 rounded-md border border-running/30 bg-running/10 px-1.5 text-[11.5px] font-medium text-running hover:bg-running/20"
  >
    <MessagesSquareIcon aria-hidden="true" className="size-3" />
    Thread
  </Link>
);

/**
 * A label in GitHub's colour, readable on the dark theme: a tint of it behind, the colour itself
 * for the edge, and a lightened colour for the text.
 */
const labelStyle = (color: string): React.CSSProperties => {
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(color.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
  const lighten = (channel: number) => Math.round(channel + (255 - channel) * 0.45);
  return {
    backgroundColor: `rgb(${r} ${g} ${b} / 18%)`,
    borderColor: `rgb(${r} ${g} ${b} / 45%)`,
    color: `rgb(${lighten(r)} ${lighten(g)} ${lighten(b)})`,
  };
};
