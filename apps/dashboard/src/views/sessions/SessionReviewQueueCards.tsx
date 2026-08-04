import { XIcon } from "lucide-react";
import { useState } from "react";
import type { ChatComposerProps } from "./composer-types";
import { DiffLineCommentEditor } from "./session-diff-comment";
import type { SessionReviewComment } from "./session-review-queue";
import { reviewCommentLineLabel } from "./session-review-serializer";

/** ChatComposer slot: renders the queue only when fully wired and non-empty. */
export const ComposerReviewQueueSlot = ({ props }: { props: ChatComposerProps }) => {
  if (!props.reviewComments?.length || !props.onUpdateReviewComment || !props.onRemoveReviewComment)
    return null;
  return (
    <SessionReviewQueueCards
      comments={props.reviewComments}
      onUpdate={props.onUpdateReviewComment}
      onRemove={props.onRemoveReviewComment}
    />
  );
};

/** Compact queued-review cards rendered above the composer input. */
export const SessionReviewQueueCards = ({
  comments,
  onUpdate,
  onRemove,
}: {
  comments: SessionReviewComment[];
  onUpdate: (id: string, note: string) => void;
  onRemove: (id: string) => void;
}) => {
  if (comments.length === 0) return null;
  return (
    <div data-testid="review-queue" className="mb-2 flex flex-col gap-1.5">
      {comments.map((comment) => (
        <ReviewQueueCard
          key={comment.id}
          comment={comment}
          onUpdate={(note) => onUpdate(comment.id, note)}
          onRemove={() => onRemove(comment.id)}
        />
      ))}
    </div>
  );
};

const ReviewQueueCard = ({
  comment,
  onUpdate,
  onRemove,
}: {
  comment: SessionReviewComment;
  onUpdate: (note: string) => void;
  onRemove: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  return (
    <div
      data-testid="review-queue-card"
      className="rounded-control border border-border bg-surface px-2.5 py-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[11px] text-text-muted">
          {comment.path}:{reviewCommentLineLabel(comment)}
        </span>
        <button
          type="button"
          aria-label={`Remove review comment on ${comment.path}`}
          onClick={onRemove}
          className="focus-ring shrink-0 rounded-control p-0.5 text-text-muted hover:text-text"
        >
          <XIcon className="size-3" strokeWidth={1.7} />
        </button>
      </div>
      <p className="truncate font-mono text-[12px] text-[11px] text-text-subtle">
        {comment.excerpt}
      </p>
      {editing ? (
        <DiffLineCommentEditor
          initialNote={comment.note}
          saveLabel="Save"
          onSave={(note) => {
            onUpdate(note);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button
          type="button"
          aria-label={`Edit review comment on ${comment.path}`}
          onClick={() => setEditing(true)}
          className="focus-ring block w-full rounded-control text-left text-[11.5px] text-text"
        >
          {comment.note}
        </button>
      )}
    </div>
  );
};
