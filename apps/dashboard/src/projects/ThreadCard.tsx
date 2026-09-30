import { getThreadProgress, type Thread } from "@aop/common";
import { FileTextIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Link, threadPath } from "../shell/router";
import { PullRequestChip } from "./PullRequestChip";
import { ResumeThreadButton } from "./ResumeThreadButton";
import { StepsRing } from "./StepsRing";
import { formatAge, hasFailingChecks, pullRequestOf, THREAD_STATUS_LABEL } from "./selectors";
import { ThreadStatusDot } from "./ThreadStatusDot";

/**
 * One thread in the panel's overview: a row with its title and one live line, and on the
 * right where it stands (steps, pull request, age). The whole row opens the thread (a
 * stretched link on the title); the pull request chip sits above it and opens the pull
 * request instead.
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
        "group/card relative flex items-start gap-3 rounded-row border-l-2 px-3.5 py-2.5 transition-colors duration-[120ms] hover:bg-hover",
        blocked ? "border-waiting/60" : failing ? "border-blocked/60" : "border-transparent",
        thread.status === "resolved" && "opacity-70",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <CardTitle thread={thread} failing={failing} />
        {/* The group it sits in says the status; only a failing check is worth saying again. */}
        <span
          data-testid="thread-status-label"
          className={cn(
            "text-meta",
            failing ? "text-blocked" : "sr-only",
            blocked && "text-waiting",
          )}
        >
          {failing ? "Checks failing" : THREAD_STATUS_LABEL[thread.status]}
        </span>
        <StatusLine thread={thread} />
        <CardFooter thread={thread} />
      </div>
      <CardAside thread={thread} now={now} />
    </article>
  );
};

/** The title, which is the link that opens the thread, led by its status dot and an unread dot. */
const CardTitle = ({ thread, failing }: { thread: Thread; failing: boolean }) => (
  <h3 className="flex min-w-0 items-center gap-2.5 text-title text-text">
    <ThreadStatusDot status={thread.status} className={cn(failing && "bg-blocked")} />
    <Link
      to={threadPath(thread.projectId, thread.id)}
      data-testid="thread-card-link"
      className={cn(
        "line-clamp-2 min-w-0 outline-none after:absolute after:inset-0 after:rounded-row after:content-['']",
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
);

/** On the right: the steps ring (a blocked thread has none), the pull request, and how long ago it last moved. */
const CardAside = ({ thread, now }: { thread: Thread; now: number }) => {
  const progress = getThreadProgress(thread);
  const blocked = thread.status === "waiting-on-you";
  const pullRequest = pullRequestOf(thread);
  return (
    <div className="flex shrink-0 items-center gap-2.5 pt-0.5 text-meta text-text-muted">
      {progress && !blocked ? <StepsRing done={progress.done} total={progress.total} /> : null}
      {pullRequest ? (
        <PullRequestChip
          pullRequest={pullRequest}
          testId="thread-pr-chip"
          className="relative z-10"
        />
      ) : null}
      <time
        dateTime={thread.lastActivityAt}
        title={new Date(thread.lastActivityAt).toLocaleString()}
        className="min-w-8 text-right tabular-nums text-text-subtle"
      >
        {formatAge(thread.lastActivityAt, now)}
      </time>
    </div>
  );
};

/** What else the thread has: a Resume button, and its documents; the branch is in the thread's own header. */
const CardFooter = ({ thread }: { thread: Thread }) => {
  const docCount = thread.artifacts.filter((artifact) => artifact.type === "doc").length;
  if (thread.status !== "rate-limited" && docCount === 0) return null;
  return (
    <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-meta text-text-subtle">
      <ResumeThreadButton thread={thread} />
      {docCount > 0 ? (
        <span className="inline-flex items-center gap-1" data-testid="thread-docs">
          <FileTextIcon className="size-3" />
          {docCount === 1 ? "1 document" : `${docCount} documents`}
        </span>
      ) : null}
    </footer>
  );
};

/** The one live line: what a working thread is doing, or the question a blocked one is asking. */
const StatusLine = ({ thread }: { thread: Thread }) => {
  if (thread.status === "waiting-on-you") {
    return (
      <p data-testid="thread-status-line" className="line-clamp-2 text-meta text-text-muted">
        <span className="font-medium text-waiting">Blocked · </span>
        {thread.blockedQuestion.question}
      </p>
    );
  }
  if (!thread.liveStatusLine) return null;
  return (
    <p data-testid="thread-status-line" className="line-clamp-2 text-meta text-text-muted">
      {thread.liveStatusLine}
    </p>
  );
};
