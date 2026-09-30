import type { Thread } from "@aop/common";
import { ClockIcon, HourglassIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { formatShortTimestamp } from "../chat/chat-time";
import { pullRequestOf } from "../selectors";
import { threadActions } from "../thread-actions";
import { useNow } from "../use-now";

type RateLimited = Extract<Thread, { status: "rate-limited" }>;

/**
 * What a thread that is not simply working has to say: it waits for a run slot, it waits out a
 * usage limit (with the time it resumes by itself, and a way to end the wait), a merge is
 * running, or it is closed and a message would reopen it.
 */
export const ThreadNotice = ({ thread }: { thread: Thread }) => {
  switch (thread.status) {
    case "queued":
      return (
        <Notice testId="thread-notice-queued" icon={<HourglassIcon className="size-4" />}>
          <p>
            <strong className="font-medium text-text">Queued.</strong> The host is running as many
            threads as it allows. This one starts by itself when a slot is free.
          </p>
        </Notice>
      );
    case "rate-limited":
      return <RateLimitedNotice thread={thread} />;
    case "landing":
      return (
        <Notice testId="thread-notice-landing" icon={<Spinner className="size-3.5" />}>
          <p>
            <strong className="font-medium text-text">Merging the pull request.</strong> The thread
            takes no message until it is done.
          </p>
        </Notice>
      );
    case "resolved":
      return <ResolvedNotice thread={thread} />;
    default:
      return null;
  }
};

const ResolvedNotice = ({ thread }: { thread: Extract<Thread, { status: "resolved" }> }) => {
  const merged = pullRequestOf(thread)?.state === "merged";
  return (
    <Notice testId="thread-notice-resolved" icon={<ClockIcon className="size-4" />}>
      <p>
        <strong className="font-medium text-text">Resolved</strong> on{" "}
        {new Date(thread.resolvedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
        .{" "}
        {merged
          ? "Its pull request merged, so its branch is gone; further work belongs in a new thread."
          : "A message reopens it and brings its branch back."}
      </p>
    </Notice>
  );
};

/** The usage limit's wait: when it ends, counted down, and the way to end it now. */
const RateLimitedNotice = ({ thread }: { thread: RateLimited }) => {
  const now = useNow(1_000);
  const remaining = Date.parse(thread.resumesAt) - now;
  return (
    <Notice
      testId="thread-notice-rate-limited"
      tone="waiting"
      icon={<ClockIcon className="size-4" />}
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="thread-resume"
          onClick={() => void threadActions.resume(thread)}
        >
          <RotateCcwIcon />
          Resume now
        </Button>
      }
    >
      <p>
        <strong className="font-medium text-text">Rate limited.</strong> It resumes by itself at{" "}
        {formatShortTimestamp(thread.resumesAt)}
        {" · "}
        <span data-testid="thread-resume-countdown" data-remaining-ms={Math.max(0, remaining)}>
          {remaining > 0 ? `in ${formatCountdown(remaining)}` : "resuming now"}
        </span>
        .
      </p>
    </Notice>
  );
};

const Notice = ({
  testId,
  tone,
  icon,
  action,
  children,
}: {
  testId: string;
  tone?: "waiting";
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div
    data-testid={testId}
    role="status"
    className={cn(
      "mx-6 mt-3 flex items-center gap-3 rounded-card border px-3.5 py-2.5 text-[12.5px] leading-snug text-text-muted",
      tone === "waiting" ? "border-waiting/40 bg-waiting/5" : "border-border bg-raised",
    )}
  >
    <span aria-hidden="true" className={tone === "waiting" ? "text-waiting" : "text-text-subtle"}>
      {icon}
    </span>
    <div className="min-w-0 flex-1">{children}</div>
    {action}
  </div>
);

/** "42s", "12m 04s", "1h 05m": how long until a wait ends. */
export const formatCountdown = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};
