import type { InboxContextMessage, InboxItem } from "@aop/common";
import { forwardRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Textarea } from "@/ui/textarea";
import { replyToInboxItem } from "../api/inbox";
import { TickRow } from "./fields";

/**
 * Reply in Slack, as the person, in the item's thread (or its DM). Only the Send button or ⌘↵
 * sends; AOP never drafts a reply. A refusal (archived channel, not a member, Slack asking to
 * slow down) shows under the box and the text stays.
 */
export const ReplyComposer = forwardRef<
  HTMLTextAreaElement,
  {
    item: InboxItem;
    me: string;
    onSent: (message: InboxContextMessage, item: InboxItem) => void;
  }
>(({ item, me, onSent }, ref) => {
  const [text, setText] = useState("");
  const [broadcast, setBroadcast] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inThread = item.threadId !== null || item.conversation.kind === "channel";

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const sent = await replyToInboxItem(item.id, { text, broadcast: inThread && broadcast });
      setText("");
      setError(null);
      onSent(sent.message, sent.item);
      toast.success("Reply sent to Slack");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  if (item.expired) return null;
  return (
    <form
      data-testid="inbox-reply"
      className="flex flex-col gap-2 rounded-row border border-border bg-raised p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Textarea
        ref={ref}
        data-testid="inbox-reply-text"
        aria-label="Reply"
        placeholder={inThread ? `Reply in thread as ${me}…` : `Reply as ${me}…`}
        value={text}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
        className="min-h-14 border-0 bg-transparent text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      {error ? (
        <p role="alert" data-testid="inbox-reply-error" className="text-[12px] text-blocked">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {inThread && item.conversation.kind === "channel" ? (
          <TickRow testId="inbox-reply-broadcast" checked={broadcast} onChange={setBroadcast}>
            Also send to #{item.conversation.name}
          </TickRow>
        ) : null}
        <span className="ml-auto text-[11.5px] text-text-subtle">Posts as you · ⌘↵</span>
        <Button
          type="submit"
          size="sm"
          data-testid="inbox-reply-send"
          disabled={!text.trim() || sending}
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
});
ReplyComposer.displayName = "ReplyComposer";
