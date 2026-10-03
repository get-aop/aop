import { getThreadProgress, shownThreadStatus, type Thread } from "@aop/common";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Link, threadPath } from "../shell/router";
import { PullRequestChip } from "./PullRequestChip";
import { plainStatusLine } from "./plain-status-line";
import { ResumeThreadButton } from "./ResumeThreadButton";
import { StepsRing } from "./StepsRing";
import { formatAge, hasFailingChecks, pullRequestOf, THREAD_STATUS_LABEL } from "./selectors";
import { ThreadCuaChip } from "./ThreadCuaChip";
import { ThreadStatusDot } from "./ThreadStatusDot";

/**
 * One thread in the panel's overview: a row with its title and one live line, and on the
 * right where it stands (steps, pull request, age). The whole row opens the thread (a
 * stretched link on the title); the pull request chip sits above it and opens the pull
 * request instead.
 */
export const ThreadCard = ({ thread, now }: { thread: Thread; now: number }) => {
  const shown = shownThreadStatus(thread);
  const blocked = shown === "waiting-on-you";
  const failing = hasFailingChecks(thread);
  const degraded = thread.status === "working" && thread.degraded !== undefined;

  return (
    <article
      data-testid="thread-card"
      data-thread-id={thread.id}
      data-status={thread.status}
      data-shown-status={shown}
      data-unread={thread.unread}
      data-checks-failing={failing ? "true" : undefined}
      data-degraded={degraded ? "true" : undefined}
      className={cn(
        "group/card relative flex items-start gap-3 rounded-row border-l-2 px-3.5 py-2.5 transition-colors duration-[120ms] hover:bg-hover",
        cardEdge(blocked, failing || degraded),
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
          {failing ? "Checks failing" : THREAD_STATUS_LABEL[shown]}
        </span>
        <StatusLine thread={thread} />
        <ThreadCuaChip threadId={thread.id} />
        <CardFooter thread={thread} />
      </div>
      <CardAside thread={thread} now={now} />
    </article>
  );
};

// A thread waiting on the person is marked yellow; one whose checks fail or whose tools are lost, red.
const cardEdge = (blocked: boolean, alarmed: boolean): string => {
  if (blocked) return "border-waiting/60";
  return alarmed ? "border-blocked/60" : "border-transparent";
};

/** The title, which is the link that opens the thread, led by its status dot alone; unread is a bolder title, so a row never shows two dots. */
const CardTitle = ({ thread, failing }: { thread: Thread; failing: boolean }) => (
  <h3 className="flex min-w-0 items-center gap-2.5 text-title text-text">
    <ThreadStatusDot status={shownThreadStatus(thread)} className={cn(failing && "bg-blocked")} />
    <Link
      to={threadPath(thread.projectId, thread.id)}
      data-testid="thread-card-link"
      className={cn(
        "line-clamp-2 min-w-0 outline-none after:absolute after:inset-0 after:rounded-row after:content-['']",
        thread.unread ? "font-semibold" : "font-normal",
      )}
    >
      {thread.unread ? <span className="sr-only">Unread: </span> : null}
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
          repoId={thread.repoId}
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

/**
 * What else the thread has: a Resume button, where the person acts on what it waits on, and its
 * documents; the branch is in the thread's own header.
 */
const CardFooter = ({ thread }: { thread: Thread }) => {
  const docCount = thread.artifacts.filter((artifact) => artifact.type === "doc").length;
  const waitLink = thread.status === "working" ? thread.waitingOn?.link : null;
  if (thread.status !== "rate-limited" && docCount === 0 && !waitLink) return null;
  return (
    <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-meta text-text-subtle">
      <ResumeThreadButton thread={thread} />
      {waitLink ? <WaitLink href={waitLink} /> : null}
      {docCount > 0 ? (
        <span className="inline-flex items-center gap-1" data-testid="thread-docs">
          <FileTextIcon className="size-3" />
          {docCount === 1 ? "1 document" : `${docCount} documents`}
        </span>
      ) : null}
    </footer>
  );
};

/** Where the person does what a working thread waits on; it sits above the row's own link. */
const WaitLink = ({ href }: { href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer noopener"
    data-testid="thread-wait-link"
    className="relative z-10 inline-flex h-6 items-center gap-1 rounded-md border border-waiting/40 bg-waiting/10 px-2 font-medium text-waiting hover:bg-waiting/15"
  >
    <ExternalLinkIcon aria-hidden="true" className="size-3" />
    {linkHost(href)}
  </a>
);

/** "github.com" for a link a thread gave: the host says where it goes without the noise of the path. */
const linkHost = (href: string): string => {
  try {
    return new URL(href).host;
  } catch {
    return "Open link";
  }
};

/**
 * The one live line: what a working thread is doing, the question a blocked one is asking, what a
 * working one waits on the person for, or that its AOP tools are lost, which outranks the rest:
 * nothing the thread says reaches AOP until they are back.
 */
const StatusLine = ({ thread }: { thread: Thread }) => {
  if (thread.status === "waiting-on-you") {
    return (
      <p data-testid="thread-status-line" className="line-clamp-2 text-meta text-text-muted">
        <span className="font-medium text-waiting">Blocked · </span>
        {thread.blockedQuestion.question}
      </p>
    );
  }
  if (thread.status === "working" && thread.degraded) {
    return (
      <p data-testid="thread-status-line" className="line-clamp-2 text-meta text-text-muted">
        <span className="font-medium text-blocked">AOP tools lost · </span>
        {thread.degraded.reason}
      </p>
    );
  }
  if (thread.status === "working" && thread.waitingOn) {
    return (
      <p data-testid="thread-status-line" className="line-clamp-2 text-meta text-text-muted">
        <span className="font-medium text-waiting">Needs you · </span>
        {thread.waitingOn.reason}
      </p>
    );
  }
  if (!thread.liveStatusLine) return null;
  return (
    <p data-testid="thread-status-line" className="line-clamp-2 text-meta text-text-muted">
      {plainStatusLine(thread.liveStatusLine)}
    </p>
  );
};
