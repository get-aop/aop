import type { LibraryItem } from "@aop/common";
import { ClockIcon, FolderIcon, MessageSquareIcon, PinIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNow } from "../use-now";
import { expiresSoon, expiryLabel, formatAdded, formatBytes, SOURCE_LABEL } from "./library-view";

/**
 * An item's facts in one wrapping line: where it is, how big, when and how it came, where it was
 * used (a link back to its chat), and whether retention will take it.
 */
export const ItemFacts = ({
  item,
  threadTitle,
  onShowSource,
}: {
  item: LibraryItem;
  /** The title of the thread it came from, when it came from one. */
  threadTitle?: string;
  onShowSource: () => void;
}) => {
  const now = useNow();
  return (
    <div
      data-testid="library-item-facts"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-muted"
    >
      <span className="flex items-center gap-1">
        <FolderIcon aria-hidden="true" className="size-3.5" />
        {item.folder || "Library"}
      </span>
      <span>{formatBytes(item.size)}</span>
      <span title={new Date(item.createdAt).toLocaleString()}>
        {SOURCE_LABEL[item.source]} · {formatAdded(item.createdAt, now)}
      </span>
      {item.usedIn ? (
        <button
          type="button"
          data-testid="library-used-in"
          onClick={onShowSource}
          className="flex items-center gap-1 text-running hover:underline"
        >
          <MessageSquareIcon aria-hidden="true" className="size-3.5" />
          {usedInLabel(item, threadTitle)}
        </button>
      ) : null}
      <RetentionNote item={item} now={now} />
    </div>
  );
};

export const usedInLabel = (item: LibraryItem, threadTitle?: string): string => {
  const where = item.usedIn?.threadId
    ? `thread “${threadTitle ?? "a thread"}”`
    : "the coordinator chat";
  return item.usedIn?.messageId ? `Message in ${where}` : `From ${where}`;
};

const RetentionNote = ({ item, now }: { item: LibraryItem; now: number }) => {
  if (item.pinned) {
    return (
      <span data-testid="library-retention" className="flex items-center gap-1 text-text">
        <PinIcon aria-hidden="true" className="size-3.5" />
        Pinned, kept until you delete it
      </span>
    );
  }
  const label = expiryLabel(item, now);
  if (!label) {
    return (
      <span data-testid="library-retention" className="text-text-subtle">
        Kept until you delete it
      </span>
    );
  }
  return (
    <span
      data-testid="library-retention"
      className={cn("flex items-center gap-1", expiresSoon(item, now) && "text-waiting")}
      title="Pin it to keep it"
    >
      <ClockIcon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
};
