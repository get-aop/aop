import {
  type AssistantMessage,
  type Message,
  shownThreadStatus,
  type ThreadReportMessage,
  type ThreadReportOutcome,
  type UserMessage,
} from "@aop/common";
import { CircleAlertIcon, CircleCheckIcon, ClockIcon, HandIcon } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Bubble } from "@/ui/bubble";
import { ChatOriginContext } from "./artifact-links";
import { ChatMarkdown } from "./ChatMarkdown";
import { useChatThread } from "./chat-context";
import { Folded } from "./Folded";
import { MessageBlocks } from "./MessageBlocks";
import { MessageImages } from "./MessageImages";
import { MessageMeta } from "./MessageMeta";
import { isSent, SentCard, SentRow } from "./SentMessage";
import { ThreadChip } from "./ThreadChip";
import { useThreadPresence } from "./thread-presence";
import { useTurnReveal } from "./use-turn-reveal";

/**
 * A message an agent was told. The person's words: a bubble on the right, folded when long, with
 * the time and a copy button on hover. The images they sent sit above it; a message of images
 * alone has no bubble. A brief one of their routines sent is labelled with the routine's name.
 * The coordinator's words and AOP's are a card on the left that names who sent them.
 */
export const UserRow = memo(function UserRow({ message }: { message: UserMessage }) {
  if (isSent(message)) return <SentRow message={message} />;
  return (
    <div
      className="group flex flex-col items-end gap-1 pb-5"
      data-testid="user-message"
      data-message-id={message.id}
      data-message-role="user"
      data-sender={message.sender}
    >
      {message.routine ? (
        <span
          data-testid="user-message-routine"
          className="flex items-center gap-1 text-meta text-text-subtle"
        >
          <ClockIcon aria-hidden="true" className="size-3.5" />
          {message.brief ? "Brief from routine" : "Routine"} · {message.routine.name}
        </span>
      ) : null}
      <PersonWords message={message} />
      <div className="w-full max-w-[80%]">
        <MessageMeta timestamp={message.createdAt} copyText={message.text} align="end" />
      </div>
    </div>
  );
});

/**
 * An agent's reply: blocks on the left, no bubble. The same
 * row draws a reply while it is being written (`writing`) and once its message has arrived, so
 * the reply goes on in place: prose that arrives is typed out, and what is left when the turn ends
 * is typed out quickly, not dropped in. A reply whose run failed is drawn as an error, so what the
 * runtime said is not read as the agent's answer.
 */
export const AssistantRow = memo(function AssistantRow({
  message,
  writing = false,
  steers,
}: {
  message: AssistantMessage;
  writing?: boolean;
  /** Messages sent into this reply's turn while it ran: drawn where it took them in, or at its end. */
  steers?: readonly Message[];
}) {
  const { blocks, revealing } = useTurnReveal(message.blocks, writing);
  const settled = !writing && !revealing;
  // Fixed at mount: a reply that finishes in front of the person keeps rendering as it did.
  const watched = useRef(writing).current;
  const { renderSteer, untaken } = useSteers(message, steers);
  const origin = useMemo(() => ({ threadId: message.threadId }), [message.threadId]);
  const text = textOf(message);
  return (
    <div
      className="group pb-5"
      data-testid="assistant-message"
      data-message-id={message.id}
      data-message-role="assistant"
      data-writing={settled ? undefined : "true"}
      data-failed={message.failed ? "true" : undefined}
    >
      <div
        className={cn(
          "relative min-w-0 px-1 py-0.5",
          message.failed && "rounded-card border border-blocked/30 bg-blocked/5 px-3 py-2",
        )}
      >
        {message.failed ? (
          <p
            data-testid="assistant-message-failed"
            className="mb-1 flex items-center gap-1.5 text-meta font-medium text-blocked"
          >
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            This turn failed
          </p>
        ) : null}
        <ChatOriginContext.Provider value={origin}>
          <MessageBlocks
            messageId={message.id}
            blocks={blocks}
            writing={!settled}
            watched={watched}
            renderSteer={renderSteer}
          />
        </ChatOriginContext.Provider>
        {untaken.map((steer) => (
          <SteeredMessage key={steer.id} message={steer} state={writing ? "pending" : "missed"} />
        ))}
        {/* The meta's room is kept while the reply is written, so it ends without a jump. */}
        <div className="mt-1.5 min-h-6">
          {settled ? (
            <MessageMeta
              timestamp={message.createdAt}
              copyText={text}
              visualize={
                text && !message.failed
                  ? { projectId: message.projectId, messageId: message.id }
                  : undefined
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});

// Which of the messages sent into the turn it took in (drawn by its steer parts), and which not yet.
const useSteers = (message: AssistantMessage, steers: readonly Message[] | undefined) => {
  const byId = useMemo(() => new Map((steers ?? []).map((steer) => [steer.id, steer])), [steers]);
  const renderSteer = useCallback(
    (messageId: string) => {
      const steer = byId.get(messageId);
      return steer ? <SteeredMessage message={steer} state="taken" /> : null;
    },
    [byId],
  );
  const untaken = useMemo(() => {
    const taken = new Set(
      message.blocks.flatMap((block) => (block.type === "steer" ? [block.messageId] : [])),
    );
    return (steers ?? []).filter((steer) => !taken.has(steer.id));
  }, [message.blocks, steers]);
  return { renderSteer, untaken };
};

const STEER_CAPTION = {
  taken: "Sent while it worked",
  pending: "Sent while it worked · it reads this after its current step",
  missed: "Sent while it worked · the turn was stopped before reading it",
} as const;

/**
 * A message sent into a turn while it ran, drawn inside the reply: where the agent took it in,
 * or, until it does, at the reply's end. The person's words are a bubble, as anywhere else; the
 * coordinator's words keep their card, which names it and shows the person's words it forwards.
 */
const SteeredMessage = memo(function SteeredMessage({
  message,
  state,
}: {
  message: Message;
  state: keyof typeof STEER_CAPTION;
}) {
  // Only what an agent is told is sent into its turn.
  if (message.role !== "user") return null;
  return (
    <div
      data-testid="steered-message"
      data-message-id={message.id}
      data-state={state}
      data-sender={message.sender}
      className={cn("my-3 flex flex-col gap-1", isSent(message) ? "items-start" : "items-end")}
    >
      {isSent(message) ? <SentCard message={message} /> : <PersonWords message={message} />}
      <p data-testid="steered-message-caption" className="text-meta text-text-subtle">
        {STEER_CAPTION[state]}
      </p>
    </div>
  );
});

const REPORT_PHRASE: Record<ThreadReportOutcome, string> = {
  finished: "finished a turn",
  "needs-you": "needs your call",
  failed: "failed",
};

const REPORT_ICON = {
  finished: CircleCheckIcon,
  "needs-you": HandIcon,
  failed: CircleAlertIcon,
} as const;

const REPORT_TONE: Record<ThreadReportOutcome, string> = {
  finished: "text-ok",
  "needs-you": "text-waiting",
  failed: "text-blocked",
};

/**
 * What a thread told the coordinator. The server wrote it to wake the coordinator, so it is a
 * line in the conversation and not something the person said; what the thread said is behind it.
 */
export const ThreadReportRow = memo(function ThreadReportRow({
  message,
}: {
  message: ThreadReportMessage;
}) {
  const { thread } = useChatThread(message.reportedThreadId);
  const newest = useThreadPresence().latestReport.get(message.reportedThreadId);
  const [open, setOpen] = useState(false);
  const Icon = REPORT_ICON[message.outcome];
  // A report is the thread's word at that time. A newer one replaces it, and a call that has
  // been answered is not a call any more: what the thread is now is on its card.
  const superseded = newest !== undefined && newest !== message.id;
  const answered =
    message.outcome === "needs-you" &&
    thread !== undefined &&
    shownThreadStatus(thread) !== "waiting-on-you" &&
    !(thread.status === "working" && thread.degraded);
  if (superseded || answered) return null;
  return (
    <div
      data-testid="thread-report"
      data-message-id={message.id}
      data-message-role="thread-report"
      data-outcome={message.outcome}
      className="pb-4 text-meta text-text-subtle"
    >
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <Icon aria-hidden="true" className={cn("mr-1 size-3.5", REPORT_TONE[message.outcome])} />
        {thread ? <ThreadChip threadId={thread.id} /> : <span>A thread</span>}
        <span>{REPORT_PHRASE[message.outcome]}</span>
        <button
          type="button"
          data-testid="thread-report-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="ml-1 rounded-md px-1 text-text-subtle underline-offset-2 hover:text-text-muted hover:underline"
        >
          {open ? "Hide report" : "Show report"}
        </button>
      </div>
      {open ? (
        <div
          data-testid="thread-report-text"
          className="mt-1.5 max-w-xl rounded-card border border-border bg-raised/60 px-3 py-2 text-text-muted"
        >
          <ChatOriginContext.Provider value={{ threadId: message.reportedThreadId }}>
            <ChatMarkdown content={message.text} />
          </ChatOriginContext.Provider>
        </div>
      ) : null}
    </div>
  );
});

// The images the person sent, above their words in a bubble.
const PersonWords = ({ message }: { message: UserMessage }) => (
  <>
    {message.images ? <MessageImages images={message.images} /> : null}
    {message.text ? (
      <Bubble className="relative">
        <FoldedText text={message.text} />
      </Bubble>
    ) : null}
  </>
);

const FoldedText = ({ text }: { text: string }) => (
  <Folded text={text}>
    <p data-testid="user-message-text" className="min-w-0 whitespace-pre-wrap break-words">
      {text}
    </p>
  </Folded>
);

const textOf = (message: AssistantMessage): string =>
  message.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
