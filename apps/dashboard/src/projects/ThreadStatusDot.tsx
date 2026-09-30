import type { ThreadStatus } from "@aop/common";
import { cn } from "@/lib/cn";

const DOT_CLASS: Record<ThreadStatus, string> = {
  "waiting-on-you": "bg-waiting",
  working: "aop-running-dot bg-running motion-safe:animate-[aop-pulse_2s_ease-in-out_infinite]",
  // Rings, not fills: neither is doing anything now. One waits for a run slot, one for a rate limit.
  queued: "ring-1 ring-inset ring-queued",
  "rate-limited": "ring-1 ring-inset ring-waiting",
  "ready-for-review": "bg-ok",
  landing: "bg-running",
  idle: "bg-queued",
  resolved: "bg-queued/50",
};

/** The one glyph that says what state a thread is in; colour is the whole message, so it also has text beside it. */
export const ThreadStatusDot = ({
  status,
  className,
}: {
  status: ThreadStatus;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    data-testid="thread-status-dot"
    className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[status], className)}
  />
);
