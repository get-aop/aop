import type {
  GithubUser,
  PullRequestViewCommit,
  PullRequestViewReviewThread,
  PullRequestViewTimelineItem,
} from "@aop/common";
import {
  CheckCircle2Icon,
  CircleDotIcon,
  EyeIcon,
  FileDiffIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  type LucideIcon,
  MessageSquareIcon,
  PencilIcon,
  TagIcon,
  UserIcon,
  XCircleIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ChatMarkdown } from "../chat/ChatMarkdown";
import { Ago, Avatar, LabelChip, plural, RollupDot } from "./bits";

type Comment = Extract<PullRequestViewTimelineItem, { kind: "comment" | "review" }>;
type Event = Extract<PullRequestViewTimelineItem, { kind: "event" }>;

/** The Conversation tab's history, oldest first, the way GitHub draws it down a line. */
export const Timeline = ({ items }: { items: PullRequestViewTimelineItem[] }) => (
  <ol
    data-testid="pr-timeline"
    className="relative flex flex-col gap-4 before:absolute before:inset-y-0 before:left-[19px] before:w-px before:bg-border"
  >
    {items.map((item) => (
      <li key={keyOf(item)} className="relative">
        <TimelineItem item={item} />
      </li>
    ))}
  </ol>
);

const keyOf = (item: PullRequestViewTimelineItem): string => {
  if (item.kind === "commits") return `commits:${item.commits[0]?.sha ?? item.at}`;
  if (item.kind === "event") return `event:${item.event}:${item.at}:${item.subject ?? ""}`;
  return `${item.kind}:${item.id}`;
};

const TimelineItem = ({ item }: { item: PullRequestViewTimelineItem }) => {
  if (item.kind === "commits") return <CommitGroup commits={item.commits} at={item.at} />;
  if (item.kind === "event") return <EventRow event={item} />;
  // A review with nothing to say is only its verdict, drawn as an event line.
  if (item.kind === "review" && !item.body.trim()) return <ReviewVerdict review={item} />;
  return <CommentCard comment={item} />;
};

const REVIEW_WORDS: Record<Extract<Comment, { kind: "review" }>["state"], string> = {
  approved: "approved these changes",
  changes_requested: "requested changes",
  commented: "reviewed",
  dismissed: "reviewed (dismissed)",
  pending: "started a review",
};

const verbOf = (comment: Comment): string =>
  comment.kind === "review" ? REVIEW_WORDS[comment.state] : "commented";

/** A comment or a review with a body: a card beside the author's avatar, its body as markdown. */
export const CommentCard = ({
  comment,
  verb,
  testId = "pr-comment",
}: {
  comment: Pick<Comment, "author" | "body" | "createdAt" | "url"> &
    Partial<Pick<Comment, "kind">> & { state?: string };
  verb?: string;
  testId?: string;
}) => (
  <article data-testid={testId} className="flex gap-3">
    <span className="relative z-10 mt-1">
      <Avatar user={comment.author} size={40} />
    </span>
    <div className="min-w-0 flex-1 overflow-hidden rounded-card border border-border-strong">
      <header className="flex flex-wrap items-center gap-x-1.5 border-b border-border-strong bg-raised px-4 py-2 text-meta text-text-muted">
        <span className="font-medium text-text">{comment.author?.login ?? "ghost"}</span>
        {verb ?? verbOf(comment as Comment)}
        {comment.url ? (
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:underline"
          >
            <Ago at={comment.createdAt} />
          </a>
        ) : (
          <Ago at={comment.createdAt} />
        )}
      </header>
      <div className="px-4 py-3">
        {comment.body.trim() ? (
          <ChatMarkdown content={comment.body} />
        ) : (
          <p className="text-body text-text-subtle">No description provided.</p>
        )}
      </div>
    </div>
  </article>
);

const REVIEW_ICON: Record<Extract<Comment, { kind: "review" }>["state"], [LucideIcon, string]> = {
  approved: [CheckCircle2Icon, "bg-ok text-white"],
  changes_requested: [XCircleIcon, "bg-blocked text-white"],
  commented: [EyeIcon, "bg-raised text-text-muted"],
  dismissed: [EyeIcon, "bg-raised text-text-subtle"],
  pending: [EyeIcon, "bg-raised text-text-subtle"],
};

const ReviewVerdict = ({ review }: { review: Extract<Comment, { kind: "review" }> }) => {
  const [Icon, tone] = REVIEW_ICON[review.state];
  return (
    <EventLine icon={Icon} tone={tone} testId="pr-review-verdict">
      <Avatar user={review.author} size={18} />
      <Actor login={review.author?.login ?? null} /> {REVIEW_WORDS[review.state]}{" "}
      <Ago at={review.createdAt} />
    </EventLine>
  );
};

const CommitGroup = ({ commits, at }: { commits: PullRequestViewCommit[]; at: string }) => (
  <div data-testid="pr-timeline-commits">
    <EventLine icon={GitCommitHorizontalIcon}>
      <Actor login={commits[0]?.authors[0]?.login ?? null} /> added{" "}
      {plural(commits.length, "commit")} <Ago at={at} />
    </EventLine>
    <ul className="mt-1 flex flex-col pl-12">
      {commits.map((commit) => (
        <CommitLine key={commit.sha} commit={commit} />
      ))}
    </ul>
  </div>
);

export const CommitLine = ({ commit }: { commit: PullRequestViewCommit }) => (
  <li data-testid="pr-commit-line" className="flex min-w-0 items-center gap-2 py-0.5 text-meta">
    <AvatarStack users={commit.authors} />
    <a
      href={commit.url}
      target="_blank"
      rel="noreferrer noopener"
      className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text-muted hover:text-running hover:underline"
    >
      {commit.headline}
    </a>
    <RollupDot state={commit.checks} />
    <a
      href={commit.url}
      target="_blank"
      rel="noreferrer noopener"
      className="shrink-0 font-mono text-[12px] text-text-subtle hover:text-running hover:underline"
    >
      {commit.shortSha}
    </a>
  </li>
);

export const AvatarStack = ({ users }: { users: GithubUser[] }) => (
  <span className="flex shrink-0 -space-x-1.5" title={users.map((user) => user.login).join(", ")}>
    {users.slice(0, 3).map((user) => (
      <Avatar key={user.login} user={user} size={18} />
    ))}
  </span>
);

const EVENT_ICON: Record<Event["event"], [LucideIcon, string?]> = {
  labeled: [TagIcon],
  unlabeled: [TagIcon],
  closed: [GitPullRequestClosedIcon, "bg-blocked text-white"],
  reopened: [CircleDotIcon, "bg-ok text-white"],
  merged: [GitMergeIcon, "bg-merged text-white"],
  ready_for_review: [EyeIcon],
  converted_to_draft: [GitPullRequestDraftIcon],
  force_pushed: [GitCommitHorizontalIcon],
  review_requested: [EyeIcon],
  assigned: [UserIcon],
  renamed: [PencilIcon],
  referenced: [MessageSquareIcon],
  base_changed: [FileDiffIcon],
  head_deleted: [FileDiffIcon],
  auto_merge_enabled: [GitMergeIcon],
};

const EVENT_WORDS: Record<Event["event"], (event: Event) => ReactNode> = {
  labeled: (event) => <>added {event.label ? <LabelChip {...event.label} /> : "a label"}</>,
  unlabeled: (event) => <>removed {event.label ? <LabelChip {...event.label} /> : "a label"}</>,
  closed: () => "closed this",
  reopened: () => "reopened this",
  merged: (event) => (
    <>
      merged commit <Code>{event.subject}</Code>
    </>
  ),
  ready_for_review: () => "marked this pull request as ready for review",
  converted_to_draft: () => "marked this pull request as draft",
  force_pushed: (event) => (
    <>
      force-pushed the branch to <Code>{event.subject}</Code>
    </>
  ),
  review_requested: (event) => (
    <>
      requested a review from <b className="font-medium text-text">{event.subject}</b>
    </>
  ),
  assigned: (event) => (
    <>
      assigned <b className="font-medium text-text">{event.subject}</b>
    </>
  ),
  renamed: (event) => (
    <>
      changed the title <span className="text-text">{event.subject}</span>
    </>
  ),
  referenced: (event) =>
    event.url ? (
      <>
        mentioned this in{" "}
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-running hover:underline"
        >
          {event.subject}
        </a>
      </>
    ) : (
      "mentioned this"
    ),
  base_changed: (event) => (
    <>
      changed the base branch to <Code>{event.subject}</Code>
    </>
  ),
  head_deleted: (event) => (
    <>
      deleted the <Code>{event.subject}</Code> branch
    </>
  ),
  auto_merge_enabled: () => "enabled auto-merge",
};

const EventRow = ({ event }: { event: Event }) => {
  const [Icon, tone] = EVENT_ICON[event.event];
  return (
    <EventLine icon={Icon} tone={tone} testId="pr-timeline-event">
      <Actor login={event.actor} /> {EVENT_WORDS[event.event](event)} <Ago at={event.at} />
    </EventLine>
  );
};

const EventLine = ({
  icon: Icon,
  tone = "bg-raised text-text-muted",
  testId,
  children,
}: {
  icon: LucideIcon;
  tone?: string;
  testId?: string;
  children: ReactNode;
}) => (
  <div
    data-testid={testId}
    className="flex min-h-8 items-center gap-3 pl-[7px] text-meta text-text-muted"
  >
    <span
      className={cn(
        "relative z-10 grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-background",
        tone,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
    <span className="flex min-w-0 flex-wrap items-center gap-x-1">{children}</span>
  </div>
);

const Actor = ({ login }: { login: string | null }) => (
  <span className="font-medium text-text">{login ?? "Someone"}</span>
);

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-raised px-1 font-mono text-[12px] text-text">{children}</code>
);

/** The line-level conversations of the review, each under its file and line; resolved ones folded. */
export const ReviewThreads = ({ threads }: { threads: PullRequestViewReviewThread[] }) => {
  if (threads.length === 0) return null;
  const open = threads.filter((thread) => !thread.isResolved).length;
  return (
    <section data-testid="pr-review-threads" className="flex flex-col gap-3 pl-[52px]">
      <h3 className="text-meta font-medium text-text">
        Review conversations · {plural(open, "unresolved")}
        {threads.length > open ? `, ${threads.length - open} resolved` : ""}
      </h3>
      {threads.map((thread) => (
        <details
          key={thread.id}
          data-testid="pr-review-thread"
          data-resolved={thread.isResolved}
          open={!thread.isResolved}
          className="overflow-hidden rounded-card border border-border-strong"
        >
          <summary className="flex cursor-pointer items-center gap-2 bg-raised px-3 py-2 font-mono text-[12.5px] text-text-muted">
            <span className="min-w-0 flex-1 truncate">
              {thread.path}
              {thread.line ? `:${thread.line}` : ""}
            </span>
            {thread.isOutdated ? <Tag>Outdated</Tag> : null}
            {thread.isResolved ? <Tag>Resolved</Tag> : null}
          </summary>
          {thread.diffHunk ? <HunkPreview hunk={thread.diffHunk} /> : null}
          <div className="flex flex-col gap-3 p-3">
            {thread.comments.map((comment) => (
              <div key={comment.id} className="flex gap-2">
                <Avatar user={comment.author} size={24} />
                <div className="min-w-0 flex-1">
                  <p className="text-meta text-text-muted">
                    <span className="font-medium text-text">
                      {comment.author?.login ?? "ghost"}
                    </span>{" "}
                    <Ago at={comment.createdAt} />
                  </p>
                  <ChatMarkdown content={comment.body} />
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
};

// The last lines of the hunk the conversation is on: the line itself is the hunk's last.
const HunkPreview = ({ hunk }: { hunk: string }) => (
  <pre className="overflow-x-auto border-b border-border bg-background px-3 py-2 font-mono text-[12px] leading-5">
    {lastLines(hunk).map(({ key, text }) => (
      <div
        key={key}
        className={cn(
          text.startsWith("+") && "bg-diff-add-fill text-diff-add-text",
          text.startsWith("-") && "bg-diff-del-fill text-diff-del-text",
        )}
      >
        {text || " "}
      </div>
    ))}
  </pre>
);

const lastLines = (hunk: string) =>
  hunk
    .split("\n")
    .slice(-4)
    .map((text, position) => ({ key: `${position}:${text}`, text }));

const Tag = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full border border-border-strong px-2 py-0.5 font-sans text-[11px] text-text-subtle">
    {children}
  </span>
);
