import type { Message } from "@aop/common";
import { ChevronDownIcon } from "lucide-react";
import { memo, type ReactNode, useMemo, useRef, useState } from "react";
import { MarkerSeparator } from "@/ui/marker";
import { MessageScroller } from "@/ui/message-scroller";
import { Spinner } from "@/ui/spinner";
import { useNow } from "../use-now";
import { buildRows, type ChatRow } from "./chat-rows";
import type { EarlierMessages, LiveTurn } from "./chat-state";
import { formatElapsed } from "./chat-time";
import { AssistantRow, ThreadReportRow, UserRow } from "./MessageRows";
import { presenceOf, ThreadPresenceContext } from "./thread-presence";

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
  lead,
  messages,
  live,
  working,
  firstNewId,
  scrollToEndKey,
  worker = COORDINATOR_WORKER,
  workingSince,
  earlier,
}: {
  /** Drawn at the top of the messages on screen and scrolling with them. */
  lead?: ReactNode;
  messages: readonly Message[];
  live: Readonly<Record<string, LiveTurn>>;
  working: boolean;
  firstNewId: string | null;
  /** Each change takes the list to its end at once: the person just said something. */
  scrollToEndKey: number;
  worker?: Worker;
  /** When the turn started, for a turn no message on screen started (a thread's first). */
  workingSince?: string | null;
  earlier?: EarlierMessages;
}) => {
  const [window, setWindow] = useState(INITIAL_WINDOW);
  const [atEnd, setAtEnd] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  const { rows, hidden } = useMemo(
    () => buildRows({ messages, live, working, firstNewId, window }),
    [messages, live, working, firstNewId, window],
  );

  const presence = useMemo(() => presenceOf(messages), [messages]);

  const scrollToEnd = () =>
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });

  // What was fetched is drawn a step at a time like the rest, so the first step is shown at once.
  const loadEarlier = async () => {
    await earlier?.load();
    setWindow((current) => current + WINDOW_STEP);
  };

  return (
    <ThreadPresenceContext.Provider value={presence}>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageScroller
          scrollerRef={scroller}
          data-testid="chat-scroll"
          followKey={scrollToEndKey}
          onEdgeChange={setAtEnd}
          className="overflow-x-hidden overscroll-contain"
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end px-6 pb-4 pt-6">
            {hidden > 0 ? (
              <button
                type="button"
                data-testid="chat-show-earlier"
                onClick={() => setWindow((current) => current + WINDOW_STEP)}
                className="mx-auto mb-3 rounded-md border border-border px-3 py-1 text-meta text-text-muted hover:bg-hover hover:text-text"
              >
                Show {Math.min(WINDOW_STEP, hidden)} earlier messages
              </button>
            ) : null}
            {hidden === 0 && earlier?.available ? (
              <LoadEarlier earlier={earlier} onLoad={() => void loadEarlier()} />
            ) : null}
            {lead}
            {rows.map((row) => (
              <RowView key={row.key} row={row} worker={worker} workingSince={workingSince} />
            ))}
          </div>
        </MessageScroller>
        {/* Its own row under the transcript rather than a float over it: nothing it could cover. */}
        {atEnd ? null : (
          <div className="flex shrink-0 justify-center px-6 pb-1 pt-2">
            <button
              type="button"
              data-testid="chat-scroll-to-end"
              onClick={scrollToEnd}
              className="flex items-center gap-1 rounded-md border border-border-strong bg-overlay px-3 py-1.5 text-meta text-text-muted shadow-2 hover:text-text"
            >
              <ChevronDownIcon className="size-3.5" />
              Scroll to latest
            </button>
          </div>
        )}
      </div>
    </ThreadPresenceContext.Provider>
  );
};

const LoadEarlier = ({ earlier, onLoad }: { earlier: EarlierMessages; onLoad: () => void }) => (
  <div className="mb-3 flex flex-col items-center gap-1">
    <button
      type="button"
      data-testid="chat-load-earlier"
      disabled={earlier.loading}
      onClick={onLoad}
      className="rounded-md border border-border px-3 py-1 text-meta text-text-muted hover:bg-hover hover:text-text disabled:opacity-60"
    >
      {earlier.loading ? "Loading earlier messages…" : "Load earlier messages"}
    </button>
    {earlier.error ? (
      <p data-testid="chat-load-earlier-error" role="alert" className="text-meta text-blocked">
        Could not load earlier messages ({earlier.error}).
      </p>
    ) : null}
  </div>
);

const RowView = ({
  row,
  worker,
  workingSince,
}: {
  row: ChatRow;
  worker: Worker;
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
      return <MessageRow message={row.message} writing={row.streaming} steers={row.steers} />;
    case "working":
      return <WorkingRow worker={worker} since={row.since ?? workingSince ?? null} />;
  }
};

// A reply being written and the message it becomes go through here alike, under the same key.
const MessageRow = memo(function MessageRow({
  message,
  writing,
  steers,
}: {
  message: Message;
  writing: boolean;
  steers?: readonly Message[];
}) {
  switch (message.role) {
    case "user":
      return <UserRow message={message} />;
    case "assistant":
      return <AssistantRow message={message} writing={writing} steers={steers} />;
    case "thread-report":
      return <ThreadReportRow message={message} />;
  }
});

/** The agent at work, and for how long, below what it is writing. */
const WorkingRow = ({ worker, since }: { worker: Worker; since: string | null }) => {
  const now = useNow(1_000);
  return (
    <div data-testid={`${worker.testIdPrefix}-activity`} className="pb-5">
      <div
        data-testid={`${worker.testIdPrefix}-working`}
        role="status"
        className="flex items-center gap-2 px-1 pt-1.5 text-meta text-text-subtle"
      >
        <Spinner className="size-3" />
        <span>
          {worker.name} is working{since ? ` · ${formatElapsed(since, now)}` : ""}
        </span>
      </div>
    </div>
  );
};
