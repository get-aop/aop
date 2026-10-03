import type { UserMessage } from "@aop/common";
import { BotIcon, WaypointsIcon } from "lucide-react";
import { memo, useMemo } from "react";
import { ChatOriginContext } from "./artifact-links";
import { ChatMarkdown } from "./ChatMarkdown";
import { Folded } from "./Folded";
import { MessageMeta } from "./MessageMeta";
import { QueuedNote } from "./SteerStatus";

/** A message to an agent that the person did not type, and who sent it. */
export type SentMessage = UserMessage & { sender: "coordinator" | "system" };

export const isSent = (message: UserMessage): message is SentMessage =>
  message.sender === "coordinator" || message.sender === "system";

/**
 * The coordinator's message to a thread (its brief, or a steer), or AOP's own (a fix for a pull
 * request): on the left, in a card that names its sender, so it is never read as the person's.
 * The person's words the coordinator forwards sit above its own.
 */
export const SentRow = memo(function SentRow({
  message,
  queued = false,
}: {
  message: SentMessage;
  /** Held for after the turn that runs now. */
  queued?: boolean;
}) {
  return (
    <div
      className="group flex flex-col items-start gap-1 pb-5"
      data-testid="user-message"
      data-message-id={message.id}
      data-message-role="user"
      data-sender={message.sender}
    >
      <SentCard message={message} />
      {queued ? <QueuedNote message={message} align="start" /> : null}
      <div className="w-full max-w-[88%]">
        <MessageMeta timestamp={message.createdAt} copyText={message.text} />
      </div>
    </div>
  );
});

/** The card itself, also drawn inside the reply whose turn it was sent into. */
export const SentCard = ({ message }: { message: SentMessage }) => {
  const origin = useMemo(() => ({ threadId: message.threadId }), [message.threadId]);
  const { icon: Icon, label } = senderLabel(message);
  return (
    <div
      data-testid="sent-message"
      data-sender={message.sender}
      data-brief={message.brief ? "true" : undefined}
      className="w-fit min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border border-border-strong bg-surface px-4 py-3 text-body text-text"
    >
      <p
        data-testid="sent-message-sender"
        className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-text-muted"
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </p>
      {message.quote ? <ForwardedQuote text={message.quote} /> : null}
      <Folded text={message.text} more={message.brief ? "Show full brief" : "Show full message"}>
        <ChatOriginContext.Provider value={origin}>
          <ChatMarkdown content={message.text} />
        </ChatOriginContext.Provider>
      </Folded>
    </div>
  );
};

const senderLabel = (message: SentMessage) =>
  message.sender === "coordinator"
    ? {
        icon: WaypointsIcon,
        label: message.brief ? "Brief from the coordinator" : "Coordinator",
      }
    : { icon: BotIcon, label: message.brief ? "Brief from AOP" : "AOP" };

/** The person's own words, as the coordinator forwarded them with its message. */
const ForwardedQuote = ({ text }: { text: string }) => (
  <figure
    data-testid="forwarded-quote"
    className="mb-2 rounded-md border-l-2 border-border-bold bg-raised px-3 py-2"
  >
    <figcaption className="text-meta text-text-subtle">You said:</figcaption>
    <blockquote
      data-testid="forwarded-quote-text"
      className="mt-0.5 whitespace-pre-wrap break-words text-text-muted"
    >
      {text}
    </blockquote>
  </figure>
);
