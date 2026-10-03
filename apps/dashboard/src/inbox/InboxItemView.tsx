import type { InboxContextMessage, InboxItem } from "@aop/common";
import { ArrowLeftIcon, CheckIcon, ExternalLinkIcon, LinkIcon, SendIcon } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { setInboxState } from "../api/inbox";
import { openExternalUrl } from "../api/settings";
import { inboxPath, Link } from "../shell/router";
import { DispatchDialog } from "./DispatchDialog";
import { Avatar } from "./InboxList";
import { ItemContext } from "./ItemContext";
import { ItemLinks } from "./ItemLinks";
import { MoreMenu, SnoozeMenu } from "./ItemMenus";
import { whereOf, whyHere } from "./inbox-format";
import { LinkDialog } from "./LinkDialog";
import { MessageText } from "./MessageText";
import { ReplyComposer } from "./ReplyComposer";

/** What the page's keys do to the open item (E, R, D, O). */
export interface ItemViewHandle {
  done: () => void;
  reply: () => void;
  dispatch: () => void;
  openInSlack: () => void;
}

/**
 * One item: who, where, why it is here, the message, its folded context, what it is linked to,
 * and what to do: dispatch a thread, link it, mark it done, snooze it, reply as the person, mute
 * its channel or open it in Slack.
 */
export const InboxItemView = forwardRef<
  ItemViewHandle,
  {
    item: InboxItem;
    me: string;
    projectFilter: string | null;
    onChanged: (item: InboxItem) => void;
    onDone: (item: InboxItem) => void;
  }
>(({ item, me, projectFilter, onChanged, onDone }, ref) => {
  const [dialog, setDialog] = useState<"dispatch" | "link" | null>(null);
  const [sent, setSent] = useState<InboxContextMessage[]>([]);
  const replyBox = useRef<HTMLTextAreaElement>(null);

  const latest = useRef({ item, onChanged });
  latest.current = { item, onChanged };
  const id = item.id;
  // Opening an item reads it; the replies sent belong to the item they were sent from.
  useEffect(() => {
    setSent([]);
    const { item: opened, onChanged: changed } = latest.current;
    if (opened.id === id && opened.state === "unread") {
      void setInboxState(id, { state: "read" }).then(changed, () => undefined);
    }
  }, [id]);

  const done = async () => {
    try {
      const updated = await setInboxState(item.id, { state: "done" });
      onDone(updated);
      toast.success("Done");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not mark it done");
    }
  };
  const openInSlack = () => {
    if (item.permalink) openExternalUrl(item.permalink);
  };

  useImperativeHandle(ref, () => ({
    done: () => void done(),
    reply: () => replyBox.current?.focus(),
    dispatch: () => setDialog("dispatch"),
    openInSlack,
  }));

  return (
    <article
      data-testid="inbox-item"
      data-item-id={item.id}
      className="flex flex-col gap-4 p-4 md:p-5"
    >
      <Link
        to={inboxPath()}
        data-testid="inbox-back"
        className="flex items-center gap-1 self-start text-[12.5px] text-text-muted hover:text-text md:hidden"
      >
        <ArrowLeftIcon className="size-3.5" />
        Inbox
      </Link>
      <header className="flex items-start gap-3">
        <Avatar name={item.author.name} url={item.author.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-text">
            <span className="font-semibold">{item.author.name}</span>{" "}
            <span className="text-text-muted">in {whereOf(item)}</span>
          </p>
          <p data-testid="inbox-why" className="text-[12.5px] text-text-subtle">
            {whyHere(item)} ·{" "}
            {new Date(item.receivedAt).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {item.messageCount > 1 ? ` · ${item.messageCount} messages` : ""}
            {item.state === "snoozed" && item.snoozedUntil
              ? ` · snoozed until ${new Date(item.snoozedUntil).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
              : ""}
          </p>
        </div>
        {item.permalink ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="inbox-open-slack"
            onClick={openInSlack}
          >
            Open in Slack
            <ExternalLinkIcon />
          </Button>
        ) : null}
      </header>

      <Body item={item} />
      <ItemContext item={item} sent={sent} />
      <ItemLinks item={item} onChanged={onChanged} />

      <div data-testid="inbox-actions" className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="inbox-dispatch-open"
          onClick={() => setDialog("dispatch")}
          disabled={item.expired}
        >
          <SendIcon />
          Dispatch thread
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="inbox-link-open"
          onClick={() => setDialog("link")}
        >
          <LinkIcon />
          Link…
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="inbox-done"
          disabled={item.state === "done"}
          onClick={() => void done()}
        >
          <CheckIcon />
          Done
        </Button>
        <SnoozeMenu item={item} onChanged={onChanged} />
        <MoreMenu item={item} />
      </div>

      <ReplyComposer
        ref={replyBox}
        item={item}
        me={me}
        onSent={(message, updated) => {
          setSent((current) => [...current, message]);
          onChanged(updated);
        }}
      />

      {dialog === "dispatch" ? (
        <DispatchDialog
          item={item}
          projectFilter={projectFilter}
          onClose={() => setDialog(null)}
          onDispatched={onChanged}
        />
      ) : null}
      {dialog === "link" ? (
        <LinkDialog
          item={item}
          projectFilter={projectFilter}
          onClose={() => setDialog(null)}
          onLinked={onChanged}
        />
      ) : null}
    </article>
  );
});
InboxItemView.displayName = "InboxItemView";

const Body = ({ item }: { item: InboxItem }) => {
  if (item.expired) {
    return (
      <p className="text-[13px] text-text-subtle">
        This message is past the Inbox's retention: its text is gone, its links stay.
      </p>
    );
  }
  if (item.deleted) {
    return <p className="text-[13px] text-text-subtle">Deleted in Slack.</p>;
  }
  return <MessageText text={item.text} className="text-[14px] leading-relaxed text-text" />;
};
