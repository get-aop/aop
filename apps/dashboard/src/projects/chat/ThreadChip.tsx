import { shownThreadStatus, type Thread } from "@aop/common";
import { cn } from "@/lib/cn";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import { Link, threadPath } from "../../shell/router";
import { formatAge, THREAD_STATUS_LABEL } from "../selectors";
import { ThreadStatusDot } from "../ThreadStatusDot";
import { useChatThread } from "./chat-context";

/**
 * A thread mentioned in a sentence: its state and title, opening the thread. The card that
 * shows on hover reads the same thread, so it is current whenever it is looked at.
 */
export const ThreadChip = ({ threadId }: { threadId: string }) => {
  const { thread, loaded, projectId } = useChatThread(threadId);

  if (!thread) {
    return (
      <span
        data-testid="thread-chip-missing"
        className="mx-0.5 inline-flex items-center rounded-md border border-dashed border-border-strong px-1.5 text-text-subtle"
      >
        {loaded ? "Deleted thread" : "Thread"}
      </span>
    );
  }

  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <Link
          to={threadPath(projectId, thread.id)}
          data-testid="thread-chip"
          data-thread-id={thread.id}
          data-status={thread.status}
          data-chat-chip=""
          className="mx-0.5 inline-flex max-w-[18rem] items-center gap-1.5 rounded-md border border-border bg-raised px-1.5 align-baseline font-medium text-text transition-colors duration-[120ms] hover:bg-hover"
        >
          <ThreadStatusDot status={shownThreadStatus(thread)} className="size-1.5" />
          <span className="truncate">{thread.title}</span>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent data-testid="thread-chip-popover" className="w-64 p-3">
        <ThreadChipDetails thread={thread} now={Date.now()} />
      </HoverCardContent>
    </HoverCard>
  );
};

/** Status, title, and how much has been said in the thread: what the chip's hover card shows. */
export const ThreadChipDetails = ({ thread, now }: { thread: Thread; now: number }) => {
  const shown = shownThreadStatus(thread);
  const blocked = shown === "waiting-on-you";
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-2 text-meta">
        <ThreadStatusDot status={shown} />
        <span
          data-testid="thread-chip-status"
          className={cn("text-text-muted", blocked && "text-waiting")}
        >
          {THREAD_STATUS_LABEL[shown]}
        </span>
      </p>
      <p data-testid="thread-chip-title" className="text-body font-medium text-text">
        {thread.title}
      </p>
      <p data-testid="thread-chip-activity" className="text-meta text-text-subtle">
        {repliesLabel(thread.repliesCount)} · {formatAge(thread.lastActivityAt, now)}
      </p>
    </div>
  );
};

const repliesLabel = (count: number): string => {
  if (count === 0) return "No replies yet";
  return count === 1 ? "1 reply" : `${count} replies`;
};
