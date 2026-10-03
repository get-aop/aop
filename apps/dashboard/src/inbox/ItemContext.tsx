import type { InboxContext, InboxContextMessage, InboxItem } from "@aop/common";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getInboxContext } from "../api/inbox";
import { Avatar } from "./InboxList";
import { messageOf } from "./inbox-format";
import { MessageText } from "./MessageText";

/**
 * The conversation around an item, folded: opening it reads the thread's parent and its last
 * three replies from Slack (never stored), and "N earlier replies" reads the rest. A reply the
 * person sends from AOP shows here at once, marked "from AOP".
 */
export const ItemContext = ({
  item,
  sent,
}: {
  item: InboxItem;
  /** Replies sent from the composer since the item was opened. */
  sent: InboxContextMessage[];
}) => {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<InboxContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(
    async (all: boolean) => {
      try {
        setContext(await getInboxContext(item.id, all));
        setError(null);
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
    [item.id],
  );

  useEffect(() => {
    if (open) void read(false);
  }, [open, read]);

  if (item.expired || item.deleted) return null;
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <section data-testid="inbox-context" className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="inbox-context-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 self-start text-[12.5px] text-text-muted hover:text-text"
      >
        <Chevron className="size-3.5" />
        {item.threadId || item.conversation.kind === "channel" ? "Thread context" : "Conversation"}
      </button>
      {open ? (
        <ContextBody context={context} error={error} sent={sent} onAll={() => void read(true)} />
      ) : null}
    </section>
  );
};

const ContextBody = ({
  context,
  error,
  sent,
  onAll,
}: {
  context: InboxContext | null;
  error: string | null;
  sent: InboxContextMessage[];
  onAll: () => void;
}) => (
  <div className="flex flex-col gap-2 border-l border-border pl-3">
    {error ? (
      <p data-testid="inbox-context-error" className="text-[12.5px] text-blocked">
        Could not read the conversation from Slack: {error}
      </p>
    ) : null}
    {!context && !error ? (
      <p className="text-[12.5px] text-text-subtle">Reading from Slack…</p>
    ) : null}
    {context?.parent ? <ContextMessage message={context.parent} note="parent" /> : null}
    {context && context.earlier > 0 ? <Earlier count={context.earlier} onClick={onAll} /> : null}
    {(context ? withSent(context.messages, sent) : sent).map((message) => (
      <ContextMessage key={message.id} message={message} />
    ))}
  </div>
);

const Earlier = ({ count, onClick }: { count: number; onClick: () => void }) => (
  <button
    type="button"
    data-testid="inbox-context-earlier"
    onClick={onClick}
    className="self-start text-[12px] text-running hover:underline"
  >
    {count} earlier {count === 1 ? "reply" : "replies"}
  </button>
);

/** What Slack returned, plus the replies just sent that it did not include yet. */
const withSent = (messages: InboxContextMessage[], sent: InboxContextMessage[]) => [
  ...messages,
  ...sent.filter((reply) => !messages.some((message) => message.id === reply.id)),
];

const ContextMessage = ({ message, note }: { message: InboxContextMessage; note?: string }) => (
  <div data-testid="inbox-context-message" data-from-aop={message.fromAop} className="flex gap-2">
    <Avatar name={message.author.name} url={message.author.avatarUrl} size={6} />
    <div className="min-w-0 flex-1">
      <p className="text-[12px] text-text-subtle">
        <span className="font-medium text-text">
          {message.fromMe ? "You" : message.author.name}
        </span>{" "}
        {new Date(message.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {note ? ` · ${note}` : ""}
        {message.fromAop ? " · from AOP" : ""}
      </p>
      <MessageText text={message.text} className="text-[13px] text-text" />
    </div>
  </div>
);
