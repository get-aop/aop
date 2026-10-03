import type { CuaLeaseState, LiveViewSession } from "@aop/common";
import { ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Link, threadPath } from "../shell/router";
import { leaseSummary } from "./cua-lease";
import { pickLiveViewThread } from "./live-view-store";

/** The red "live" dot; it holds still while the session is ending. */
export const LiveDot = ({ ending }: { ending: boolean }) => (
  <span
    data-testid="live-view-dot"
    aria-hidden="true"
    className={cn(
      "size-2 shrink-0 rounded-full",
      ending ? "bg-text-subtle" : "bg-blocked animate-[aop-pulse_1.6s_ease-in-out_infinite]",
    )}
  />
);

/** The thread's title, linking to the thread. */
export const ThreadTitle = ({
  session,
  onNavigate,
  className,
}: {
  session: LiveViewSession;
  onNavigate?: () => void;
  className?: string;
}) => (
  <Link
    to={threadPath(session.projectId, session.threadId)}
    data-testid="live-view-thread-link"
    title={`Open the thread “${session.title}”`}
    onClick={onNavigate}
    className={cn("min-w-0 truncate text-[12px] font-medium text-text hover:underline", className)}
  >
    {session.title}
  </Link>
);

/**
 * Who holds the computer-use lease and how many threads wait for it. `compact` (the popup's narrow
 * header) leaves out the holder when it is the thread on screen, whose title is already there,
 * and then says nothing at all while no one waits; the whole line stays in the tooltip.
 */
export const LeaseSummary = ({
  lease,
  current,
  compact = false,
}: {
  lease: CuaLeaseState;
  current: LiveViewSession;
  compact?: boolean;
}) => {
  const full = leaseSummary(lease);
  const { holder, queue } = lease;
  const holdsIt = holder?.kind === "thread" && holder.threadId === current.threadId;
  const text = compact && holdsIt ? (queue.length > 0 ? `${queue.length} waiting` : null) : full;
  if (!full || !text) return null;
  return (
    <span
      data-testid="live-view-lease"
      data-holder={holder ? (holder.kind === "thread" ? holder.threadId : "external") : "none"}
      data-waiting={queue.length}
      title={full}
      className="min-w-0 shrink truncate text-[11px] text-text-muted"
    >
      {text}
    </span>
  );
};

/** Picks which thread's session to watch when more than one uses computer use. */
export const SessionSwitcher = ({
  sessions,
  current,
}: {
  sessions: LiveViewSession[];
  current: LiveViewSession;
}) => {
  if (sessions.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="live-view-switcher"
          aria-label={`${sessions.length} threads use computer use: switch`}
          title="Switch thread"
          className="flex h-6 shrink-0 items-center gap-0.5 rounded-row px-1 text-[11px] text-text-muted hover:bg-hover hover:text-text"
        >
          {sessions.length}
          <ChevronsUpDownIcon className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-testid="live-view-switcher-menu">
        <DropdownMenuLabel className="text-[11px] text-text-muted">
          Threads using computer use
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.threadId} onValueChange={pickLiveViewThread}>
          {inStartOrder(sessions).map((session) => (
            <DropdownMenuRadioItem
              key={session.threadId}
              value={session.threadId}
              data-testid={`live-view-switcher-${session.threadId}`}
            >
              <span className="truncate">{session.title}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** The picture, or why there is none. */
export const FramePicture = ({
  url,
  error,
  onAspect,
  className,
}: {
  url: string | null;
  error: string | null;
  onAspect?: (aspect: number) => void;
  className?: string;
}) => {
  if (error) {
    return (
      <span
        data-testid="live-view-error"
        role="status"
        className="block p-3 text-center text-meta text-text-muted"
      >
        {error}
      </span>
    );
  }
  if (!url) {
    return (
      <span
        data-testid="live-view-connecting"
        className="block p-3 text-center text-meta text-text-subtle"
      >
        Connecting to the host's screen…
      </span>
    );
  }
  return (
    <img
      data-testid="live-view-image"
      src={url}
      alt="The host's screen"
      draggable={false}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) onAspect?.(naturalHeight / naturalWidth);
      }}
      className={cn("block select-none object-contain", className)}
    />
  );
};

// The host lists sessions most recently active first, which changes while threads take turns;
// the menu keeps them in the order they started, so an item does not move under the pointer.
const inStartOrder = (sessions: LiveViewSession[]): LiveViewSession[] =>
  [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
