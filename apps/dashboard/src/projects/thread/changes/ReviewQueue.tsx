import type { Thread } from "@aop/common";
import { SendIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { threadActions } from "../../thread-actions";
import { ReviewQueueCards } from "./ReviewQueueCards";
import {
  clearThreadReviewQueue,
  removeThreadReviewComment,
  type ThreadReviewComment,
  updateThreadReviewComment,
} from "./review-queue";
import { serializeReviewMessage } from "./review-serializer";

/**
 * The review comments left on the diff and not yet sent. They go to the thread together, as
 * one message it can act on. A send that fails keeps them, with the reason.
 */
export const ReviewQueue = ({
  thread,
  comments,
  onSent,
}: {
  thread: Thread;
  comments: ThreadReviewComment[];
  onSent: () => void;
}) => {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (comments.length === 0) return null;

  const busy = thread.status === "landing";
  const send = async () => {
    setSending(true);
    setError(null);
    const result = await threadActions.steer(thread, serializeReviewMessage(comments, ""));
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    clearThreadReviewQueue(thread.id);
    toast.success(
      comments.length === 1
        ? "Sent 1 review comment to the thread"
        : `Sent ${comments.length} review comments to the thread`,
    );
    onSent();
  };

  return (
    <section
      data-testid="review-queue-panel"
      className="shrink-0 border-t border-border bg-surface px-6 py-3"
    >
      <ReviewQueueCards
        comments={comments}
        onUpdate={(id, note) => updateThreadReviewComment(thread.id, id, note)}
        onRemove={(id) => removeThreadReviewComment(thread.id, id)}
      />
      {error ? (
        <p role="alert" data-testid="review-send-error" className="mb-2 text-[12px] text-blocked">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {busy ? (
          <span className="text-[12px] text-text-subtle">
            The thread takes no message while its pull request merges.
          </span>
        ) : null}
        <Button
          type="button"
          size="sm"
          data-testid="review-send"
          disabled={sending || busy}
          onClick={() => void send()}
        >
          <SendIcon />
          {comments.length === 1
            ? "Send 1 comment to the thread"
            : `Send ${comments.length} comments to the thread`}
        </Button>
      </div>
    </section>
  );
};
