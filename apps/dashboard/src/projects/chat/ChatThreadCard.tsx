import {
  type Artifact,
  getThreadProgress,
  type Thread,
  type ThreadCardVariant,
  threadCardVariant,
} from "@aop/common";
import { CircleCheckIcon, HandIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Link, threadPath } from "../../shell/router";
import { PullRequestChip } from "../PullRequestChip";
import { ResumeThreadButton } from "../ResumeThreadButton";
import { StepsRing } from "../StepsRing";
import { ThreadStatusDot } from "../ThreadStatusDot";
import { ThreadsLoadError } from "../ThreadsLoadError";
import { useChatThread } from "./chat-context";

type PullRequest = Extract<Artifact, { type: "pr" }>;

/**
 * One thread in the conversation. Which look it has follows the thread, not the message: a
 * card the coordinator posted as `needs-call` turns `live` when the person answers, and `done`
 * when the work ends. `variant` is only what a card looks like until its thread has loaded.
 */
export const ChatThreadCard = ({
  threadId,
  variant,
}: {
  threadId: string;
  variant: ThreadCardVariant;
}) => {
  const { thread, loaded, error, projectId } = useChatThread(threadId);

  if (!thread) {
    return (
      <UnavailableCard
        threadId={threadId}
        variant={variant}
        loaded={loaded}
        error={error}
        projectId={projectId}
      />
    );
  }

  const shown = threadCardVariant(thread.status);
  return (
    <article
      data-testid="chat-thread-card"
      data-thread-id={thread.id}
      data-variant={shown}
      data-status={thread.status}
      className={cn(
        "relative my-2 flex max-w-xl flex-col gap-1.5 rounded-card border bg-raised p-3 transition-colors duration-[120ms] hover:bg-hover",
        shown === "needs-call" ? "border-waiting/40" : "border-border",
      )}
    >
      <header className="flex items-center gap-2">
        <VariantIcon variant={shown} thread={thread} />
        <h4 className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-text">
          <Link
            to={threadPath(projectId, thread.id)}
            data-testid="chat-thread-card-link"
            className="line-clamp-1 outline-none after:absolute after:inset-0 after:rounded-card after:content-['']"
          >
            {thread.title}
          </Link>
        </h4>
        <CardTrailing thread={thread} variant={shown} />
      </header>
      <CardBody thread={thread} variant={shown} />
    </article>
  );
};

const VariantIcon = ({ variant, thread }: { variant: ThreadCardVariant; thread: Thread }) => {
  if (variant === "needs-call") {
    return (
      <HandIcon data-testid="chat-thread-card-icon" className="size-4 shrink-0 text-waiting" />
    );
  }
  if (variant === "done") {
    return (
      <CircleCheckIcon data-testid="chat-thread-card-icon" className="size-4 shrink-0 text-ok" />
    );
  }
  return <ThreadStatusDot status={thread.status} className="mx-1" />;
};

const CardTrailing = ({ thread, variant }: { thread: Thread; variant: ThreadCardVariant }) => {
  const pullRequest = thread.artifacts.find(
    (artifact): artifact is PullRequest => artifact.type === "pr",
  );
  const progress = getThreadProgress(thread);
  return (
    <>
      {variant === "live" && progress ? (
        <StepsRing done={progress.done} total={progress.total} />
      ) : null}
      {pullRequest ? (
        <PullRequestChip
          pullRequest={pullRequest}
          testId="chat-thread-card-pr"
          className="relative z-10 shrink-0"
        />
      ) : null}
    </>
  );
};

const CardBody = ({ thread, variant }: { thread: Thread; variant: ThreadCardVariant }) => {
  if (thread.status === "waiting-on-you") {
    const { question, options } = thread.blockedQuestion;
    return (
      <>
        <p data-testid="chat-thread-card-question" className="text-[13px] leading-snug text-text">
          {question}
        </p>
        {options.length > 0 ? (
          <p
            data-testid="chat-thread-card-options"
            className="text-[12.5px] leading-snug text-text-muted"
          >
            Reply with:{" "}
            {options
              .map(({ label, recommended }) => (recommended ? `${label} (recommended)` : label))
              .join(", or ")}
          </p>
        ) : null}
        <Button
          asChild
          size="sm"
          variant="outline"
          className="relative z-10 mt-1 self-start border-waiting/40 text-waiting hover:text-waiting"
        >
          <Link to={threadPath(thread.projectId, thread.id)} data-testid="chat-thread-card-view">
            View thread
          </Link>
        </Button>
      </>
    );
  }
  const line = thread.liveStatusLine ?? (variant === "live" ? "Working…" : null);
  return (
    <>
      {line ? (
        <p
          data-testid="chat-thread-card-status"
          className="line-clamp-2 text-[12.5px] text-text-muted"
        >
          {line}
        </p>
      ) : null}
      <ResumeThreadButton thread={thread} className="mt-1 self-start" />
    </>
  );
};

const UnavailableCard = ({
  threadId,
  variant,
  loaded,
  error,
  projectId,
}: {
  threadId: string;
  variant: ThreadCardVariant;
  loaded: boolean;
  error: string | null;
  projectId: string;
}) => (
  <article
    data-testid="chat-thread-card-unavailable"
    data-thread-id={threadId}
    data-variant={variant}
    className="my-2 max-w-xl rounded-card border border-dashed border-border-strong p-3 text-[12.5px] text-text-subtle"
  >
    {unavailableReason(loaded, error, projectId)}
  </article>
);

const unavailableReason = (
  loaded: boolean,
  error: string | null,
  projectId: string,
): React.ReactNode => {
  if (loaded) return "This thread no longer exists.";
  if (error) return <ThreadsLoadError projectId={projectId} subject="this thread" error={error} />;
  return "Loading thread…";
};
