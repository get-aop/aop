import type { Message } from "@aop/common";
import { ChevronDownIcon } from "lucide-react";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { MarkerSeparator } from "@/ui/marker";
import { MessageScroller } from "@/ui/message-scroller";
import { Spinner } from "@/ui/spinner";
import { useNow } from "../use-now";
import { ChatMarkdown } from "./ChatMarkdown";
import { buildRows, type ChatRow } from "./chat-rows";
import type { EarlierMessages } from "./chat-state";
import { formatElapsed } from "./chat-time";
import { AssistantRow, ThreadReportRow, UserRow } from "./MessageRows";
import { useStreamingReveal } from "./use-streaming-reveal";

const INITIAL_WINDOW = 60;
const WINDOW_STEP = 60;

/** Who answers in a conversation: what its "at work" line calls it, and the prefix of that line's test ids. */
export interface Worker {
  name: string;
  testIdPrefix: string;
}

export const COORDINATOR_WORKER: Worker = { name: "Coordinator", testIdPrefix: "coordinator" };

/**
 * The conversation, oldest first, following the newest message while the person is at the
 * bottom and staying put once they scroll up. Only the latest messages are drawn until more
 * are asked for; once every one held is drawn, older ones are fetched from the host on request.
 */
export const MessageList = ({
  messages,
  live,
  working,
  firstNewId,
  scrollToEndKey,
  worker = COORDINATOR_WORKER,
  workLogOf,
  liveWorkLog,
  workingSince,
  earlier,
}: {
  messages: readonly Message[];
  live: Readonly<Record<string, string>>;
  working: boolean;
  firstNewId: string | null;
  /** Each change takes the list to its end at once: the person just said something. */
  scrollToEndKey: number;
  worker?: Worker;
  /** What the agent did to write the reply with this id (its tool calls), drawn above the reply. */
  workLogOf?: (messageId: string) => ReactNode;
  /** The same for the turn being written now, drawn in the "at work" row. */
  liveWorkLog?: ReactNode;
  /** When the turn started, for a turn no message on screen started (a thread's first). */
  workingSince?: string | null;
  earlier?: EarlierMessages;
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

  // What was fetched is drawn a step at a time like the rest, so the first step is shown at once.
  const loadEarlier = async () => {
    await earlier?.load();
    setWindow((current) => current + WINDOW_STEP);
  };

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
          {hidden === 0 && earlier?.available ? (
            <LoadEarlier earlier={earlier} onLoad={() => void loadEarlier()} />
          ) : null}
          {rows.map((row) => (
            <RowView
              key={row.key}
              row={row}
              worker={worker}
              workLogOf={workLogOf}
              liveWorkLog={liveWorkLog}
              workingSince={workingSince}
            />
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

const LoadEarlier = ({ earlier, onLoad }: { earlier: EarlierMessages; onLoad: () => void }) => (
  <div className="mb-3 flex flex-col items-center gap-1">
    <button
      type="button"
      data-testid="chat-load-earlier"
      disabled={earlier.loading}
      onClick={onLoad}
      className="rounded-md border border-border px-3 py-1 text-xs text-text-muted hover:bg-hover hover:text-text disabled:opacity-60"
    >
      {earlier.loading ? "Loading earlier messages…" : "Load earlier messages"}
    </button>
    {earlier.error ? (
      <p data-testid="chat-load-earlier-error" role="alert" className="text-[12px] text-blocked">
        Could not load earlier messages ({earlier.error}).
      </p>
    ) : null}
  </div>
);

const RowView = ({
  row,
  worker,
  workLogOf,
  liveWorkLog,
  workingSince,
}: {
  row: ChatRow;
  worker: Worker;
  workLogOf?: (messageId: string) => ReactNode;
  liveWorkLog?: ReactNode;
  workingSince?: string | null;
}) => {
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
      return <MessageRow message={row.message} workLog={workLogOf?.(row.message.id)} />;
    case "activity":
      return (
        <ActivityRow
          worker={worker}
          liveText={row.liveText}
          since={row.since ?? workingSince ?? null}
          workLog={liveWorkLog}
        />
      );
  }
};

const MessageRow = memo(function MessageRow({
  message,
  workLog,
}: {
  message: Message;
  workLog: ReactNode;
}) {
  switch (message.role) {
    case "user":
      return <UserRow message={message} />;
    case "assistant":
      return <AssistantRow message={message} workLog={workLog} />;
    case "thread-report":
      return <ThreadReportRow message={message} />;
  }
});

/** The agent at work: what it has written so far, typed out as it arrives, and how long it has been. */
const ActivityRow = ({
  worker,
  liveText,
  since,
  workLog,
}: {
  worker: Worker;
  liveText: string;
  since: string | null;
  workLog: ReactNode;
}) => {
  const now = useNow(1_000);
  const shown = useStreamingReveal(liveText, true);
  return (
    <div data-testid={`${worker.testIdPrefix}-activity`} className="pb-4">
      {workLog}
      {shown ? (
        <div data-testid={`${worker.testIdPrefix}-live-text`} className="min-w-0 px-1 py-0.5">
          <ChatMarkdown content={shown} />
        </div>
      ) : null}
      <div
        data-testid={`${worker.testIdPrefix}-working`}
        role="status"
        className="flex items-center gap-2 px-1 pt-1.5 text-[12px] text-text-subtle"
      >
        <Spinner className="size-3" />
        <span>
          {worker.name} is working{since ? ` · ${formatElapsed(since, now)}` : ""}
        </span>
      </div>
    </div>
  );
};
