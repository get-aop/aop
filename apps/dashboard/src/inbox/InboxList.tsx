import type { InboxItem } from "@aop/common";
import { cn } from "@/lib/cn";
import { useNow } from "../projects/use-now";
import { inboxPath, Link } from "../shell/router";
import { initialsOf, REASON_TAG, relativeTime, whereOf } from "./inbox-format";

/** The items of a view, newest first: who, where, why, when, and the message's start. */
export const InboxList = ({
  items,
  selectedId,
  hasMore,
  onLoadMore,
}: {
  items: InboxItem[];
  selectedId: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
}) => {
  const now = useNow();
  return (
    <ul data-testid="inbox-list" className="flex flex-col">
      {items.map((item) => (
        <InboxRow key={item.id} item={item} now={now} selected={item.id === selectedId} />
      ))}
      {hasMore ? (
        <li className="px-3 py-2">
          <button
            type="button"
            data-testid="inbox-load-more"
            onClick={onLoadMore}
            className="text-[12.5px] text-running hover:underline"
          >
            Older items
          </button>
        </li>
      ) : null}
    </ul>
  );
};

const InboxRow = ({ item, now, selected }: { item: InboxItem; now: number; selected: boolean }) => {
  const unread = item.state === "unread";
  return (
    <li>
      <Link
        to={inboxPath(item.id)}
        data-testid="inbox-row"
        data-item-id={item.id}
        data-state={item.state}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex gap-2.5 border-b border-border px-3 py-2.5 transition-colors duration-[120ms] hover:bg-hover",
          selected && "bg-active",
        )}
      >
        <Avatar name={item.author.name} url={item.author.avatarUrl} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "truncate text-[13px]",
                unread ? "font-semibold text-text" : "text-text-muted",
              )}
            >
              {item.author.name}
            </span>
            <span className="truncate text-[12px] text-text-subtle">{whereOf(item)}</span>
            <span
              className="ml-auto shrink-0 text-[11.5px] text-text-subtle"
              title={new Date(item.receivedAt).toLocaleString()}
            >
              {relativeTime(item.receivedAt, now)}
            </span>
          </div>
          <p className="line-clamp-2 text-[12.5px] break-words text-text-muted">
            <ReasonTag item={item} />
            {item.deleted
              ? "Deleted in Slack"
              : item.expired
                ? "Past the Inbox's retention"
                : item.text}
          </p>
          {item.links.length > 0 ? (
            <p className="truncate text-[11.5px] text-text-subtle">
              {item.links.map((link) => link.title ?? link.ref).join(" · ")}
            </p>
          ) : null}
        </div>
        {unread ? (
          <span
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-text"
            data-testid="inbox-row-unread"
          >
            <span className="sr-only">Unread</span>
          </span>
        ) : null}
      </Link>
    </li>
  );
};

export const ReasonTag = ({ item }: { item: Pick<InboxItem, "reason"> }) => (
  <span
    data-testid="inbox-reason"
    className="mr-1.5 inline-block rounded-[5px] border border-border-strong px-1 text-[11px] leading-4 text-text"
  >
    {REASON_TAG[item.reason]}
  </span>
);

/** The author's picture, or their initials when there is none or it fails to load. */
export const Avatar = ({
  name,
  url,
  size = 8,
}: {
  name: string;
  url: string | null;
  size?: 6 | 8;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-raised text-[11px] font-semibold text-text-muted",
      size === 8 ? "size-8" : "size-6",
    )}
  >
    {initialsOf(name)}
    {url ? (
      <img
        src={url}
        alt=""
        className="absolute inset-0 size-full object-cover"
        onError={(event) => event.currentTarget.remove()}
      />
    ) : null}
  </span>
);
