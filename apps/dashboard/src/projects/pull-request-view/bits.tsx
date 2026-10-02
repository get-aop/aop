import type { GithubUser, PullRequestViewCheck, PullRequestViewDetail } from "@aop/common";
import {
  CheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleSlashIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  MinusIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { GithubAvatar } from "../pull-requests/GithubAvatar";
import { formatAgo } from "../selectors";
import { useSharedNow } from "../use-now";

/*
 * The small pieces every part of the PR View draws: the state badge, a check's status icon, an
 * avatar, and a time that reads as GitHub's ("3 hours ago", the date on hover).
 */

type ShownState = "open" | "draft" | "merged" | "closed";

export const shownStateOf = ({
  state,
  isDraft,
}: Pick<PullRequestViewDetail, "state" | "isDraft">): ShownState =>
  state === "open" && isDraft ? "draft" : state;

const STATE: Record<ShownState, { label: string; tone: string; Icon: typeof GitPullRequestIcon }> =
  {
    open: { label: "Open", tone: "bg-ok text-white", Icon: GitPullRequestIcon },
    draft: { label: "Draft", tone: "bg-text-subtle text-white", Icon: GitPullRequestDraftIcon },
    merged: { label: "Merged", tone: "bg-merged text-white", Icon: GitMergeIcon },
    closed: { label: "Closed", tone: "bg-blocked text-white", Icon: GitPullRequestClosedIcon },
  };

export const StateBadge = ({
  detail,
}: {
  detail: Pick<PullRequestViewDetail, "state" | "isDraft">;
}) => {
  const shown = shownStateOf(detail);
  const { label, tone, Icon } = STATE[shown];
  return (
    <span
      data-testid="pr-state-badge"
      data-state={shown}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-meta font-medium",
        tone,
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </span>
  );
};

const CHECK: Record<
  PullRequestViewCheck["status"],
  { Icon: typeof CheckIcon; tone: string; label: string }
> = {
  success: { Icon: CheckIcon, tone: "text-ok", label: "Successful" },
  failure: { Icon: XIcon, tone: "text-blocked", label: "Failing" },
  cancelled: { Icon: CircleSlashIcon, tone: "text-text-subtle", label: "Cancelled" },
  in_progress: { Icon: CircleDotIcon, tone: "text-waiting", label: "In progress" },
  queued: { Icon: CircleDashedIcon, tone: "text-waiting", label: "Queued" },
  neutral: { Icon: MinusIcon, tone: "text-text-subtle", label: "Neutral" },
  skipped: { Icon: MinusIcon, tone: "text-text-subtle", label: "Skipped" },
};

export const checkLabel = (status: PullRequestViewCheck["status"]): string => CHECK[status].label;

export const CheckStatusIcon = ({
  status,
  className,
}: {
  status: PullRequestViewCheck["status"];
  className?: string;
}) => {
  const { Icon, tone, label } = CHECK[status];
  return (
    <Icon
      role="img"
      aria-label={label}
      data-status={status}
      className={cn(
        "size-4 shrink-0",
        tone,
        status === "in_progress" && "animate-pulse",
        className,
      )}
    />
  );
};

/** A commit's rollup: the dot GitHub draws beside a commit. */
export const RollupDot = ({ state }: { state: "pending" | "success" | "failure" | null }) =>
  state === null ? null : (
    <CheckStatusIcon status={state === "pending" ? "in_progress" : state} className="size-3.5" />
  );

/** A GitHub account's picture; its initial when it has none or the picture does not load. */
export const Avatar = ({ user, size = 20 }: { user: GithubUser | null; size?: number }) => (
  <GithubAvatar login={user?.login ?? "?"} avatarUrl={user?.avatarUrl ?? null} size={size} />
);

/** "3 hours ago", kept current; the exact time on hover. */
export const Ago = ({ at, className }: { at: string; className?: string }) => {
  const now = useSharedNow();
  if (!at) return null;
  return (
    <time dateTime={at} title={new Date(at).toLocaleString()} className={className}>
      {formatAgo(at, now)}
    </time>
  );
};

export const plural = (count: number, noun: string, many = `${noun}s`): string =>
  `${count.toLocaleString()} ${count === 1 ? noun : many}`;

/** A GitHub label in its colour, readable on the dark page whatever the colour is. */
export const LabelChip = ({ name, color }: { name: string; color: string }) => (
  <span
    data-testid="pr-label"
    className="inline-flex h-5 items-center rounded-full border px-2 text-[12px] font-medium"
    style={{
      color: `#${color}`,
      borderColor: `#${color}66`,
      backgroundColor: `#${color}22`,
    }}
  >
    {name}
  </span>
);
