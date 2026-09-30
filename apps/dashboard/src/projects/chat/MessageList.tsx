import type { Message } from "@aop/common";
import { ChevronDownIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { MarkerSeparator } from "@/ui/marker";
import { MessageScroller } from "@/ui/message-scroller";
import { Spinner } from "@/ui/spinner";
import { useNow } from "../use-now";
import { ChatMarkdown } from "./ChatMarkdown";
import { buildRows, type ChatRow } from "./chat-rows";
import { formatElapsed } from "./chat-time";
import { AssistantRow, ThreadReportRow, UserRow } from "./MessageRows";
import { useStreamingReveal } from "./use-streaming-reveal";

const INITIAL_WINDOW = 60;
const WINDOW_STEP = 60;

/**
 * The conversation, oldest first, following the newest message while the person is at the
 * bottom and staying put once they scroll up. Only the latest messages are drawn until more
 * are asked for.
 */
export const MessageList = ({
  messages,
  live,
  working,
  firstNewId,
  scrollToEndKey,
}: {
  messages: readonly Message[];
  live: Readonly<Record<string, string>>;
  working: boolean;
  firstNewId: string | null;
  /** Each change takes the list to its end at once: the person just said something. */
  scrollToEndKey: number;
}) => {
  const [window, setWindow] = useState(INITIAL_WINDOW);
  const [atEnd, setAtEnd] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollToEndKey > 0) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [scrollToEndKey]);
  const { rows, hidden } = useMemo(
    () => buildRows({ messages, live, working, firstNewId, window }),
    [messages, live, working, firstNewId, window],
  );

  const scrollToEnd = () =>
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });

  return (
    <div className="relative flex min-h-0 flex-1">
      <MessageScroller
        scrollerRef={scroller}
        data-testid="chat-scroll"
        streaming={working}
        anchorKey={rows.length}
        onEdgeChange={setAtEnd}
        className="overflow-x-hidden overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end px-6 pb-2 pt-6">
          {hidden > 0 ? (
            <button
              type="button"
              data-testid="chat-show-earlier"
              onClick={() => setWindow((current) => current + WINDOW_STEP)}
              className="mx-auto mb-3 rounded-md border border-border px-3 py-1 text-xs text-text-muted hover:bg-hover hover:text-text"
            >
              Show {Math.min(WINDOW_STEP, hidden)} earlier messages
            </button>
          ) : null}
          {rows.map((row) => (
            <RowView key={row.key} row={row} />
          ))}
        </div>
      </MessageScroller>
      {atEnd ? null : (
        <button
          type="button"
          data-testid="chat-scroll-to-end"
          onClick={scrollToEnd}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border-strong bg-overlay px-3 py-1.5 text-xs text-text-muted shadow-2 hover:text-text"
        >
          <ChevronDownIcon className="size-3.5" />
          Scroll to latest
        </button>
      )}
    </div>
  );
};

const RowView = ({ row }: { row: ChatRow }) => {
  switch (row.kind) {
    case "day":
      return <MarkerSeparator data-testid="day-separator">{row.label}</MarkerSeparator>;
    case "new":
      return (
        <MarkerSeparator data-testid="new-messages-marker" className="text-running">
          New
        </MarkerSeparator>
      );
    case "message":
      return <MessageRow message={row.message} />;
    case "activity":
      return <ActivityRow liveText={row.liveText} since={row.since} />;
  }
};

const MessageRow = memo(function MessageRow({ message }: { message: Message }) {
  switch (message.role) {
    case "user":
      return <UserRow message={message} />;
    case "assistant":
      return <AssistantRow message={message} />;
    case "thread-report":
      return <ThreadReportRow message={message} />;
  }
});

/** The coordinator at work: what it has written so far, typed out as it arrives, and how long it has been. */
const ActivityRow = ({ liveText, since }: { liveText: string; since: string | null }) => {
  const now = useNow(1_000);
  const shown = useStreamingReveal(liveText, true);
  return (
    <div data-testid="coordinator-activity" className="pb-4">
      {shown ? (
        <div data-testid="coordinator-live-text" className="min-w-0 px-1 py-0.5">
          <ChatMarkdown content={shown} />
        </div>
      ) : null}
      <div
        data-testid="coordinator-working"
        role="status"
        className="flex items-center gap-2 px-1 pt-1.5 text-[12px] text-text-subtle"
      >
        <Spinner className="size-3" />
        <span>Coordinator is working{since ? ` · ${formatElapsed(since, now)}` : ""}</span>
      </div>
    </div>
  );
};
