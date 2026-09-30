import { type Artifact, getThreadProgress, type Thread } from "@aop/common";
import { FileTextIcon, GitBranchIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Link, threadPath } from "../shell/router";
import { PullRequestChip } from "./PullRequestChip";
import { ResumeThreadButton } from "./ResumeThreadButton";
import { StepsRing } from "./StepsRing";
import { formatAge, hasFailingChecks, THREAD_STATUS_LABEL } from "./selectors";
import { ThreadStatusDot } from "./ThreadStatusDot";

type PullRequest = Extract<Artifact, { type: "pr" }>;

/**
 * One thread on the project home. The whole card opens the thread (a stretched link on the
 * title); the pull request chip sits above it and opens the pull request instead.
 */
export const ThreadCard = ({ thread, now }: { thread: Thread; now: number }) => {
  const blocked = thread.status === "waiting-on-you";
  const failing = hasFailingChecks(thread);

  return (
    <article
      data-testid="thread-card"
      data-thread-id={thread.id}
      data-status={thread.status}
      data-unread={thread.unread}
      data-checks-failing={failing ? "true" : undefined}
      className={cn(
        "group/card relative flex min-h-[132px] flex-col gap-2 rounded-card border bg-raised p-3.5 transition-colors duration-[120ms] hover:bg-hover",
        blocked ? "border-waiting/40" : failing ? "border-blocked/30" : "border-border",
        thread.status === "resolved" && "opacity-70",
      )}
    >
      <CardHeader thread={thread} now={now} />

      <h3 className="min-w-0 text-[14px] leading-snug text-text">
        <Link
          to={threadPath(thread.projectId, thread.id)}
          data-testid="thread-card-link"
          className={cn(
            "line-clamp-2 outline-none after:absolute after:inset-0 after:rounded-card after:content-['']",
            thread.unread ? "font-semibold" : "font-medium",
          )}
        >
          {thread.unread ? (
            <span
              data-testid="thread-unread-dot"
              role="img"
              aria-label="Unread"
              className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-unread align-middle"
            />
          ) : null}
          {thread.title}
        </Link>
      </h3>

      <StatusLine thread={thread} />
      <CardFooter thread={thread} />
    </article>
  );
};

/** Status, then, on the right, the steps ring (a blocked thread has none) and how long ago it last moved. */
const CardHeader = ({ thread, now }: { thread: Thread; now: number }) => {
  const progress = getThreadProgress(thread);
  const blocked = thread.status === "waiting-on-you";
  const failing = hasFailingChecks(thread);
  return (
    <header className="flex items-center gap-2 text-[12px] text-text-muted">
      <ThreadStatusDot status={thread.status} className={cn(failing && "bg-blocked")} />
      <span
        data-testid="thread-status-label"
        className={cn(blocked && "text-waiting", failing && "text-blocked")}
      >
        {failing ? "Checks failing" : THREAD_STATUS_LABEL[thread.status]}
      </span>
      <span className="flex-1" />
      {progress && !blocked ? <StepsRing done={progress.done} total={progress.total} /> : null}
      <time
        dateTime={thread.lastActivityAt}
        title={new Date(thread.lastActivityAt).toLocaleString()}
        className="tabular-nums text-text-subtle"
      >
        {formatAge(thread.lastActivityAt, now)}
      </time>
    </header>
  );
};

/** What the thread produced (its pull request, its documents) and the branch it works on. */
const CardFooter = ({ thread }: { thread: Thread }) => {
  const pullRequest = thread.artifacts.find(
    (artifact): artifact is PullRequest => artifact.type === "pr",
  );
  const docCount = thread.artifacts.filter((artifact) => artifact.type === "doc").length;
  return (
    <footer className="mt-auto flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[11.5px] text-text-subtle">
      {pullRequest ? (
        <PullRequestChip
          pullRequest={pullRequest}
          testId="thread-pr-chip"
          className="relative z-10"
        />
      ) : null}
      <ResumeThreadButton thread={thread} />
      {docCount > 0 ? (
        <span className="inline-flex items-center gap-1" data-testid="thread-docs">
          <FileTextIcon className="size-3" />
          {docCount === 1 ? "1 document" : `${docCount} documents`}
        </span>
      ) : null}
      {thread.branch ? (
        <span className="inline-flex min-w-0 items-center gap-1">
          <GitBranchIcon className="size-3 shrink-0" />
          <span className="truncate">{thread.branch}</span>
        </span>
      ) : null}
    </footer>
  );
};

/** The one live line: what a working thread is doing, or the question a blocked one is asking. */
const StatusLine = ({ thread }: { thread: Thread }) => {
  if (thread.status === "waiting-on-you") {
    return (
      <p data-testid="thread-status-line" className="line-clamp-2 text-[12.5px] text-text-muted">
        <span className="font-medium text-waiting">Blocked · </span>
        {thread.blockedQuestion.question}
      </p>
    );
  }
  if (!thread.liveStatusLine) return null;
  return (
    <p data-testid="thread-status-line" className="line-clamp-2 text-[12.5px] text-text-muted">
      {thread.liveStatusLine}
    </p>
  );
};
