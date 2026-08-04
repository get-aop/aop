import type { ChatActionPayload } from "@aop/common";
import { ChevronDownIcon } from "lucide-react";
import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MarkerSeparator } from "@/ui/marker";
import { MessageScroller } from "@/ui/message-scroller";
import type { ChatSessionMessage } from "../../api/client";
import type { StreamCommandGroup } from "./ChatStreamActivity";
import { ChatTimelineMinimap } from "./ChatTimelineMinimap";
import {
  AssistantTimelineRow,
  LiveAssistantTimelineRow,
  UserTimelineRow,
} from "./ChatTimelineRows";
import {
  buildTimelineMinimapItems,
  HISTORY_MESSAGE_BATCH,
  INITIAL_HISTORY_MESSAGES,
  type PreparedChatMessage,
  prepareMessages,
} from "./chat-timeline-model";
import { useSessionStreamProgress } from "./session-stream-progress";

const NO_WORKERS: Array<{ id: string; name: string }> = [];
const NO_TASKS: Array<{ id: string; status: string; assignedAgentId?: string | null }> = [];
const NO_HINTS: Record<string, "queued" | "steered"> = {};
const NOOP = () => {};

interface ChatThreadProps {
  sessionId?: string | null;
  repoPath?: string | null;
  onOpenFile?: (path: string) => void;
  repoName: string;
  runtime: string;
  model: string;
  effort: string;
  alias: string | null;
  messages: ChatSessionMessage[];
  midRunHints?: Record<string, "queued" | "steered">;
  typing: boolean;
  streamProgress?: {
    thinking: string;
    content: string;
    commandGroups?: StreamCommandGroup[];
  } | null;
  workerNames: string[];
  workers?: Array<{ id: string; name: string }>;
  workerColors: Record<string, string>;
  onAction: (action: ChatActionPayload) => void;
  onNavigate?: (path: string) => void;
  tasks?: Array<{ id: string; status: string; assignedAgentId?: string | null }>;
  onRetryFresh?: (runId: string) => void;
  assistantFooter?: ReactNode;
}

export const ChatThread = memo(function ChatThread({
  sessionId = null,
  repoPath = null,
  onOpenFile = NOOP,
  repoName,
  messages,
  midRunHints = NO_HINTS,
  typing,
  streamProgress: controlledStreamProgress,
  workerNames,
  workers = NO_WORKERS,
  workerColors,
  onAction,
  onNavigate = NOOP,
  tasks = NO_TASKS,
  onRetryFresh,
  assistantFooter,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [historyLimit, setHistoryLimit] = useState(INITIAL_HISTORY_MESSAGES);
  const [visibleMinimapIds, setVisibleMinimapIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleStart = Math.max(0, messages.length - historyLimit);
  const preparedMessages = useMemo(
    () => prepareMessages(messages, visibleStart, midRunHints),
    [messages, midRunHints, visibleStart],
  );
  const minimapItems = useMemo(
    () => buildTimelineMinimapItems(preparedMessages.visible),
    [preparedMessages.visible],
  );
  const activeTurnStartedAt = lastVisibleUserTimestamp(preparedMessages.visible);
  const hasControlledStream = Boolean(
    controlledStreamProgress?.thinking ||
      controlledStreamProgress?.content ||
      (controlledStreamProgress?.commandGroups?.length ?? 0) > 0,
  );
  const empty = messages.length === 0 && !typing && !hasControlledStream;
  const latestAssistantMessageId = lastAssistantMessageId(messages);

  const scrollToEnd = useCallback((behavior: ScrollBehavior = "auto") => {
    const thread = scrollRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior });
  }, []);

  const updateVisibleMinimapItems = useCallback(() => {
    const thread = scrollRef.current;
    if (!thread) return;
    const visible = visibleUserMessageIds(thread);
    setVisibleMinimapIds((current) => (sameStringSet(current, visible) ? current : visible));
  }, []);

  const onScroll = useCallback(() => {
    updateVisibleMinimapItems();
  }, [updateVisibleMinimapItems]);

  const loadEarlier = useCallback(() => {
    setHistoryLimit((limit) => limit + HISTORY_MESSAGE_BATCH);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: session changes reset the timeline window
  useEffect(() => {
    setHistoryLimit(INITIAL_HISTORY_MESSAGES);
    requestAnimationFrame(() => scrollToEnd());
  }, [sessionId, scrollToEnd]);

  useEffect(() => {
    if (preparedMessages.visible.length === 0) {
      setVisibleMinimapIds(new Set());
      return;
    }
    requestAnimationFrame(updateVisibleMinimapItems);
  }, [preparedMessages.visible.length, updateVisibleMinimapItems]);

  const renderMessage = (prepared: PreparedChatMessage) => (
    <Fragment key={prepared.message.id}>
      {prepared.dayMarker ? (
        <MarkerSeparator data-testid="day-separator">{prepared.dayMarker}</MarkerSeparator>
      ) : null}
      {prepared.message.role === "user" ? (
        <UserTimelineRow
          message={prepared.message}
          midRunHint={prepared.midRunHint}
          workerNames={workerNames}
          workerColors={workerColors}
          repoPath={repoPath}
          onOpenFile={onOpenFile}
        />
      ) : (
        <AssistantTimelineRow
          message={prepared.message}
          previousUserCreatedAt={prepared.previousUserCreatedAt}
          sessionId={sessionId}
          onAction={onAction}
          onNavigate={onNavigate}
          tasks={tasks}
          workers={workers}
          repoPath={repoPath}
          onOpenFile={onOpenFile}
          canRetry={prepared.canRetry}
          onRetryFresh={onRetryFresh}
          footer={prepared.message.id === latestAssistantMessageId ? assistantFooter : null}
        />
      )}
    </Fragment>
  );

  return (
    <div className="session-chat-thread-shell relative flex min-h-0 flex-1">
      <MessageScroller
        scrollerRef={scrollRef}
        className="aop-scroll overflow-x-hidden overscroll-contain"
        id="aop-chat-scroll"
        data-testid="chat-thread"
        streaming={typing || hasControlledStream}
        anchorKey={messages.length}
        onEdgeChange={setAtEnd}
        onScroll={onScroll}
      >
        <div className="chat-column chat-thread-content">
          {empty ? (
            <div data-testid="chat-empty-state" className="my-auto py-5 text-center">
              <div className="mx-auto w-full max-w-5xl font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
                What should we build in{" "}
                <span className="inline cursor-pointer border-current border-b border-dotted text-foreground underline-offset-8 transition-opacity hover:opacity-75">
                  {repoName || "this project"}
                </span>
                ?
              </div>
            </div>
          ) : (
            <>
              {visibleStart > 0 ? (
                <button
                  type="button"
                  className="mx-auto mb-3 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                  data-testid="load-earlier-chat-messages"
                  onClick={loadEarlier}
                >
                  Show {Math.min(HISTORY_MESSAGE_BATCH, visibleStart)} earlier messages
                </button>
              ) : null}
              {preparedMessages.visible.map(renderMessage)}
              <LiveAssistantStream
                sessionId={sessionId}
                controlledProgress={controlledStreamProgress}
                typing={typing}
                startedAt={activeTurnStartedAt}
              />
              {preparedMessages.deferred.map(renderMessage)}
            </>
          )}
        </div>
      </MessageScroller>
      <ChatTimelineMinimap
        items={minimapItems}
        visibleItemIds={visibleMinimapIds}
        scrollRef={scrollRef}
      />
      {!atEnd ? (
        <button
          type="button"
          onClick={() => scrollToEnd("smooth")}
          className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
        >
          <ChevronDownIcon className="size-3.5" />
          Scroll to end
        </button>
      ) : null}
    </div>
  );
});

const LiveAssistantStream = ({
  sessionId,
  controlledProgress,
  typing,
  startedAt,
}: {
  sessionId: string | null;
  controlledProgress?: {
    thinking: string;
    content: string;
    commandGroups?: StreamCommandGroup[];
  } | null;
  typing: boolean;
  startedAt: string | null;
}) => {
  const storedProgress = useSessionStreamProgress(sessionId);
  const progress = controlledProgress !== undefined ? controlledProgress : storedProgress;
  const hasStream = Boolean(
    progress?.thinking || progress?.content || (progress?.commandGroups?.length ?? 0) > 0,
  );

  if (!typing && !hasStream) return null;
  return (
    <LiveAssistantTimelineRow
      thinking={progress?.thinking ?? ""}
      content={progress?.content ?? ""}
      commandGroups={progress?.commandGroups ?? []}
      typing={typing}
      startedAt={startedAt}
    />
  );
};

const lastAssistantMessageId = (messages: ChatSessionMessage[]): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message.id;
  }
  return null;
};

const sameStringSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value));

const visibleUserMessageIds = (thread: HTMLElement): ReadonlySet<string> => {
  const viewport = thread.getBoundingClientRect();
  const visible = new Set<string>();
  for (const row of thread.querySelectorAll<HTMLElement>('[data-message-role="user"]')) {
    const id = row.dataset.messageId;
    if (!id) continue;
    const bounds = row.getBoundingClientRect();
    if (bounds.bottom > viewport.top && bounds.top < viewport.bottom) visible.add(id);
  }
  return visible;
};

const lastVisibleUserTimestamp = (messages: PreparedChatMessage[]): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]?.message;
    if (message?.role === "user") return message.createdAt;
  }
  return null;
};
