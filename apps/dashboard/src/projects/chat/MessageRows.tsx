import type {
  AssistantMessage,
  ThreadReportMessage,
  ThreadReportOutcome,
  UserMessage,
} from "@aop/common";
import { CircleAlertIcon, CircleCheckIcon, HandIcon } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";
import { Bubble } from "@/ui/bubble";
import { ChatMarkdown } from "./ChatMarkdown";
import { useChatThread } from "./chat-context";
import { MessageBlocks } from "./MessageBlocks";
import { MessageMeta } from "./MessageMeta";
import { ThreadChip } from "./ThreadChip";
import { useThreadPresence } from "./thread-presence";

const COLLAPSED_MAX_CHARS = 600;
const COLLAPSED_MAX_LINES = 8;

/** The person's words: a bubble on the right, folded when long, with the time and a copy button on hover. */
export const UserRow = memo(function UserRow({ message }: { message: UserMessage }) {
  return (
    <div
      className="group flex flex-col items-end gap-1 pb-5"
      data-testid="user-message"
      data-message-id={message.id}
      data-message-role="user"
    >
      <Bubble className="relative">
        <FoldedText text={message.text} />
      </Bubble>
      <div className="w-full max-w-[80%]">
        <MessageMeta timestamp={message.createdAt} copyText={message.text} align="end" />
      </div>
    </div>
  );
});

/**
 * An agent's reply, or a message the coordinator relayed: blocks on the left, no bubble.
 * `workLog` is what the agent did to write it, shown above the words. A reply whose run failed
 * is drawn as an error, so what the runtime said is not read as the agent's answer.
 */
export const AssistantRow = memo(function AssistantRow({
  message,
  workLog,
}: {
  message: AssistantMessage;
  workLog?: ReactNode;
}) {
  return (
    <div
      className="group pb-5"
      data-testid="assistant-message"
      data-message-id={message.id}
      data-message-role="assistant"
      data-failed={message.failed ? "true" : undefined}
    >
      <div
        className={cn(
          "relative min-w-0 px-1 py-0.5",
          message.failed && "rounded-card border border-blocked/30 bg-blocked/5 px-3 py-2",
        )}
      >
        {workLog}
        {message.failed ? (
          <p
            data-testid="assistant-message-failed"
            className="mb-1 flex items-center gap-1.5 text-meta font-medium text-blocked"
          >
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            This turn failed
          </p>
        ) : null}
        <MessageBlocks messageId={message.id} blocks={message.blocks} />
        <div className="mt-1.5">
          <MessageMeta timestamp={message.createdAt} copyText={textOf(message)} />
        </div>
      </div>
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
    message.outcome === "needs-you" && thread !== undefined && thread.status !== "waiting-on-you";
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
          <ChatMarkdown content={message.text} />
        </div>
      ) : null}
    </div>
  );
});

const FoldedText = ({ text }: { text: string }) => {
  const [expanded, setExpanded] = useState(false);
  const foldable =
    text.length > COLLAPSED_MAX_CHARS || text.split("\n").length > COLLAPSED_MAX_LINES;
  const folded = foldable && !expanded;
  return (
    <>
      <div
        data-user-message-collapsed={folded ? "true" : "false"}
        className={cn("relative", folded && "max-h-44 overflow-hidden")}
        style={
          folded
            ? {
                maskImage: "linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)",
              }
            : undefined
        }
      >
        <p data-testid="user-message-text" className="min-w-0 whitespace-pre-wrap break-words">
          {text}
        </p>
      </div>
      {foldable ? (
        <button
          type="button"
          aria-expanded={expanded}
          data-testid="user-message-fold"
          onClick={() => setExpanded((value) => !value)}
          className="-ml-1 mt-1.5 h-7 rounded-md px-1.5 text-meta text-text-subtle hover:bg-hover hover:text-text-muted"
        >
          {expanded ? "Show less" : "Show full message"}
        </button>
      ) : null}
    </>
  );
};

const textOf = (message: AssistantMessage): string =>
  message.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
