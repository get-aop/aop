import { cuaHolderName, cuaWaitingLabel, type Thread } from "@aop/common";
import {
  ClockIcon,
  ExternalLinkIcon,
  HandIcon,
  HourglassIcon,
  MonitorIcon,
  RotateCcwIcon,
  UnplugIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { threadLeasePlace, useCuaLease } from "../../live-view/cua-lease";
import { formatShortTimestamp } from "../chat/chat-time";
import { pullRequestOf } from "../selectors";
import { threadActions } from "../thread-actions";
import { useNow } from "../use-now";

type RateLimited = Extract<Thread, { status: "rate-limited" }>;
type Working = Extract<Thread, { status: "working" }>;

/**
 * What a thread that is not simply working has to say: its AOP tools stopped reaching the host,
 * it waits on the person for something outside AOP while it works, it waits for a run slot, it
 * waits out a usage limit (with the time it resumes by itself, unless the project's auto-continue
 * is off, and a way to end the wait), a merge is running, or it is closed and a message would
 * reopen it.
 */
export const ThreadNotice = ({
  thread,
  autoContinue = true,
}: {
  thread: Thread;
  autoContinue?: boolean;
}) => {
  switch (thread.status) {
    case "working":
      return <WorkingNotice thread={thread} />;
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
      return <RateLimitedNotice thread={thread} autoContinue={autoContinue} />;
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

/**
 * The thread's place with the host's computer-use lease: waiting in line for another thread (or a
 * program outside AOP) to give the host's screen back, or holding it while others wait. One
 * thread drives the screen at a time, so a waiting thread is not stuck: its CUA call goes on by
 * itself when its turn comes.
 */
export const ThreadCuaNotice = ({ threadId }: { threadId: string }) => {
  const lease = useCuaLease();
  const place = threadLeasePlace(lease, threadId);
  if (!lease || !place) return null;
  if (place.state === "holding") {
    const others = lease.queue.length;
    return (
      <Notice testId="thread-notice-cua-holding" icon={<MonitorIcon className="size-4" />}>
        <p>
          <strong className="font-medium text-text">Using computer use.</strong>{" "}
          {others === 0
            ? "No other thread waits for the host's screen."
            : `${others === 1 ? "1 other thread waits" : `${others} other threads wait`} for the host's screen until it is done.`}
        </p>
      </Notice>
    );
  }
  return (
    <Notice
      testId="thread-notice-cua-waiting"
      tone="waiting"
      icon={<HourglassIcon className="size-4" />}
    >
      <p>
        <strong className="font-medium text-text">{cuaWaitingLabel(place.position)}.</strong>{" "}
        {lease.holder ? `${cuaHolderName(lease.holder)} is using the host's screen. ` : ""}The
        thread goes on by itself when its turn comes.
      </p>
    </Notice>
  );
};

// Lost tools come first: until they are back, the thread cannot even say it is waiting.
const WorkingNotice = ({ thread }: { thread: Working }) => {
  if (thread.degraded) {
    return (
      <Notice
        testId="thread-notice-degraded"
        tone="blocked"
        icon={<UnplugIcon className="size-4" />}
      >
        <p>
          <strong className="font-medium text-text">AOP tools lost.</strong>{" "}
          {thread.degraded.reason} The thread keeps running but cannot report, ask you or open its
          pull request through AOP. Stop it and send it a message to start a turn with working
          tools.
        </p>
      </Notice>
    );
  }
  if (!thread.waitingOn) return null;
  const { reason, link } = thread.waitingOn;
  return (
    <Notice
      testId="thread-notice-waiting-on"
      tone="waiting"
      icon={<HandIcon className="size-4" />}
      action={
        link ? (
          <Button asChild size="sm" variant="outline">
            <a href={link} target="_blank" rel="noreferrer noopener" data-testid="thread-wait-open">
              <ExternalLinkIcon />
              Open
            </a>
          </Button>
        ) : undefined
      }
    >
      <p>
        <strong className="font-medium text-text">Waiting on you.</strong> {asSentence(reason)} The
        thread keeps working meanwhile.
      </p>
    </Notice>
  );
};

/** A reason a thread wrote, ended like a sentence whether or not it ended it. */
const asSentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

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

/**
 * The usage limit's wait: when it ends, counted down, and the way to end it now. With the
 * project's auto-continue off the wait does not end by itself: past the reset the thread stays
 * stopped until the person resumes it.
 */
const RateLimitedNotice = ({
  thread,
  autoContinue,
}: {
  thread: RateLimited;
  autoContinue: boolean;
}) => {
  const now = useNow(1_000);
  const remaining = Date.parse(thread.resumesAt) - now;
  const at = formatShortTimestamp(thread.resumesAt);
  const countdown = (passed: string) => (
    <span data-testid="thread-resume-countdown" data-remaining-ms={Math.max(0, remaining)}>
      {remaining > 0 ? `in ${formatCountdown(remaining)}` : passed}
    </span>
  );
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
          {autoContinue || remaining > 0 ? "Resume now" : "Resume"}
        </Button>
      }
    >
      {autoContinue ? (
        <p>
          <strong className="font-medium text-text">Rate limited.</strong> It resumes by itself at{" "}
          {at}
          {" · "}
          {countdown("resuming now")}.
        </p>
      ) : (
        <p data-auto-continue="off">
          <strong className="font-medium text-text">Rate limited.</strong> The limit resets at {at}
          {" · "}
          {countdown("it has reset")}. Auto-continue is off for this project, so the thread waits
          for you.
        </p>
      )}
    </Notice>
  );
};

const NOTICE_TONE = {
  waiting: { box: "border-waiting/40 bg-waiting/5", icon: "text-waiting" },
  blocked: { box: "border-blocked/40 bg-blocked/5", icon: "text-blocked" },
} as const;

const Notice = ({
  testId,
  tone,
  icon,
  action,
  children,
}: {
  testId: string;
  tone?: keyof typeof NOTICE_TONE;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div
    data-testid={testId}
    role="status"
    className={cn(
      "mx-6 mt-3 flex items-center gap-3 rounded-card border px-4 py-3 text-meta text-text-muted",
      tone ? NOTICE_TONE[tone].box : "border-border bg-raised",
    )}
  >
    <span aria-hidden="true" className={tone ? NOTICE_TONE[tone].icon : "text-text-subtle"}>
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
