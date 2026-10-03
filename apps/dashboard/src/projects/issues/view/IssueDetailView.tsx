import type { IssueComment, IssueDetail, IssueSource, ProjectIssue } from "@aop/common";
import { ArrowUpRightIcon, CopyIcon, GitBranchPlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { ChatMarkdown } from "../../chat/ChatMarkdown";
import { formatAgo } from "../../selectors";
import { useNow } from "../../use-now";
import { Avatar, LabelBadge, PriorityIcon, StageIcon } from "../issue-bits";
import { LinkedPullRequestChips } from "../LinkedPullRequestChips";
import { SOURCE_NAME, SourceMark } from "../source-marks";
import type { StartThread } from "../use-start-thread";

const MILESTONE_LABEL: Record<IssueSource, string> = {
  github: "Milestone",
  linear: "Cycle",
  jira: "Fix version",
};

/**
 * An issue read whole: its title and where it stands, the actions on it, its description, the
 * sections a thread needs beside it (Jira's acceptance criteria) and its latest comments. The
 * Markdown renders with raw HTML shown as text, so nothing an issue says can run.
 */
export const IssueDetailView = ({
  projectId,
  detail,
  startThread,
}: {
  projectId: string;
  detail: IssueDetail;
  startThread: StartThread;
}) => {
  const { issue } = detail;
  const starting = startThread.pending.has(issue.key);
  return (
    <article
      data-testid="issue-detail"
      data-key={issue.key}
      data-source={issue.source}
      className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6"
    >
      <header className="flex flex-col gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-meta text-text-subtle">
          <SourceMark source={issue.source} />
          <span className="truncate">{issue.container}</span>
          <span aria-hidden="true">·</span>
          <span data-testid="issue-detail-identifier" className="tabular-nums">
            {issue.identifier}
          </span>
        </p>
        <h1
          data-testid="issue-detail-title"
          className="text-[19px] leading-snug font-medium text-text"
        >
          {issue.title}
        </h1>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            data-testid="issue-detail-start-thread"
            disabled={starting}
            onClick={() => void startThread.start(issue)}
          >
            {starting ? <Spinner className="size-3.5" /> : <GitBranchPlusIcon />}
            Start a thread
          </Button>
          <Button size="sm" variant="secondary" asChild>
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="issue-detail-open"
            >
              <ArrowUpRightIcon />
              Open in {SOURCE_NAME[issue.source]}
            </a>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="issue-detail-copy"
            onClick={() => void copyLink(issue)}
          >
            <CopyIcon />
            Copy link
          </Button>
        </div>
      </header>
      <Facts issue={issue} />
      {issue.linkedPullRequests.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <LinkedPullRequestChips projectId={projectId} pullRequests={issue.linkedPullRequests} />
        </div>
      ) : null}
      <Section title="Description" testId="issue-detail-body">
        <MarkdownOr text={detail.body} empty="No description provided." />
      </Section>
      {detail.sections.map((section) => (
        <Section key={section.title} title={section.title} testId="issue-detail-section">
          <MarkdownOr text={section.body} empty="" />
        </Section>
      ))}
      <Comments detail={detail} />
    </article>
  );
};

/** Where the issue stands and whose it is, as a wrapping row of labelled facts. */
const Facts = ({ issue }: { issue: ProjectIssue }) => {
  const now = useNow();
  return (
    <dl
      data-testid="issue-detail-facts"
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-card border border-border-strong bg-raised px-4 py-3 text-meta"
    >
      <Fact label="Status">
        <span data-testid="issue-detail-status" className="inline-flex items-center gap-1.5">
          <StageIcon stage={issue.stage} color={issue.stateColor} />
          {issue.stateName}
        </span>
      </Fact>
      {issue.priority ? (
        <Fact label="Priority">
          <span className="inline-flex items-center gap-1.5">
            <PriorityIcon priority={issue.priority} />
            {issue.priority.name}
          </span>
        </Fact>
      ) : null}
      <Fact label={issue.assignees.length > 1 ? "Assignees" : "Assignee"}>
        {issue.assignees.length === 0 ? (
          <span className="text-text-subtle">Unassigned</span>
        ) : (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {issue.assignees.map((person) => (
              <span key={person.login} className="inline-flex items-center gap-1.5">
                <Avatar person={person} size="size-4" />
                {person.login}
              </span>
            ))}
          </span>
        )}
      </Fact>
      {issue.author ? (
        <Fact label={issue.source === "jira" ? "Reporter" : "Author"}>
          <span className="inline-flex items-center gap-1.5">
            <Avatar person={issue.author} size="size-4" />
            {issue.author.login}
          </span>
        </Fact>
      ) : null}
      {issue.labels.length > 0 ? (
        <Fact label={issue.source === "jira" ? "Labels & components" : "Labels"}>
          <span className="flex flex-wrap gap-1.5">
            {issue.labels.map((label) => (
              <LabelBadge key={label.name} label={label} />
            ))}
          </span>
        </Fact>
      ) : null}
      {issue.milestone ? (
        <Fact label={MILESTONE_LABEL[issue.source]}>{issue.milestone}</Fact>
      ) : null}
      <Fact label="Updated">
        <time dateTime={issue.updatedAt} title={new Date(issue.updatedAt).toLocaleString()}>
          {formatAgo(issue.updatedAt, now)}
        </time>
      </Fact>
    </dl>
  );
};

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-text-subtle">{label}</dt>
    <dd className="min-w-0 text-text">{children}</dd>
  </>
);

const Section = ({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) => (
  <section data-testid={testId} className="flex flex-col gap-2">
    <h2 className="text-[13.5px] font-medium text-text">{title}</h2>
    <div className="min-w-0 rounded-card border border-border-strong px-4 py-3">{children}</div>
  </section>
);

const MarkdownOr = ({ text, empty }: { text: string; empty: string }) =>
  text.trim() ? (
    <ChatMarkdown content={text} />
  ) : (
    <p className="text-body text-text-subtle">{empty}</p>
  );

/** The latest comments, oldest first, and how many earlier ones are only at the source. */
const Comments = ({ detail }: { detail: IssueDetail }) => {
  const { comments, commentCount, issue } = detail;
  const earlier = commentCount - comments.length;
  return (
    <section data-testid="issue-detail-comments" className="flex flex-col gap-3">
      <h2 className="text-[13.5px] font-medium text-text">
        Comments <span className="text-text-subtle tabular-nums">{commentCount}</span>
      </h2>
      {earlier > 0 ? (
        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer noopener"
          data-testid="issue-detail-earlier"
          className="text-meta text-running hover:underline"
        >
          {earlier} earlier {earlier === 1 ? "comment" : "comments"} in {SOURCE_NAME[issue.source]}
        </a>
      ) : null}
      {comments.length === 0 ? (
        <p className="text-meta text-text-subtle">No comments yet.</p>
      ) : null}
      {comments.map((comment) => (
        <CommentCard key={comment.id} comment={comment} />
      ))}
    </section>
  );
};

const CommentCard = ({ comment }: { comment: IssueComment }) => {
  const now = useNow();
  return (
    <article data-testid="issue-detail-comment" className="flex gap-3">
      <Avatar
        person={comment.author ?? { login: "?", avatarUrl: null }}
        size="size-7"
        className="mt-1"
      />
      <div className="min-w-0 flex-1 overflow-hidden rounded-card border border-border-strong">
        <header className="flex flex-wrap items-center gap-x-1.5 border-b border-border-strong bg-raised px-3 py-1.5 text-meta text-text-muted">
          <span className="font-medium text-text">{comment.author?.login ?? "Someone"}</span>
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
            {formatAgo(comment.createdAt, now)}
          </time>
        </header>
        <div className="px-3 py-2">
          <MarkdownOr text={comment.body} empty="(No text.)" />
        </div>
      </div>
    </article>
  );
};

const copyLink = async (issue: ProjectIssue) => {
  try {
    await navigator.clipboard.writeText(issue.url);
    toast.success(`Copied the link to ${issue.identifier}`);
  } catch {
    toast.error("Could not copy the link");
  }
};
