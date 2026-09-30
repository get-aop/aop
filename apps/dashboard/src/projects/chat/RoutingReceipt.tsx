import { SendIcon } from "lucide-react";
import { ThreadChip } from "./ThreadChip";

/**
 * "Sent to 3 threads": which threads the coordinator's reply started or steered. A thread that
 * has a card of its own further down is already shown there, so only the others get a chip:
 * for a message steered into a thread, the chip is what says where it went.
 */
export const RoutingReceipt = ({
  threadIds,
  carded,
}: {
  threadIds: readonly string[];
  carded: ReadonlySet<string>;
}) => (
  <div
    data-testid="routing-receipt"
    data-thread-count={threadIds.length}
    className="mb-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-meta text-text-subtle"
  >
    <SendIcon aria-hidden="true" className="mr-1 size-3" />
    <span>{receiptLabel(threadIds.length)}</span>
    {threadIds
      .filter((threadId) => !carded.has(threadId))
      .map((threadId) => (
        <ThreadChip key={threadId} threadId={threadId} />
      ))}
  </div>
);

export const receiptLabel = (count: number): string =>
  count === 1 ? "Sent to one thread" : `Sent to ${count} threads`;
