import type { SessionDiffLine } from "@aop/common";
import { useCallback, useMemo } from "react";
import {
  type DiffReviewContextValue,
  diffLineCommentKey,
  diffLineExcerpt,
} from "./DiffLineComment";
import {
  addThreadReviewComment,
  type ThreadReviewComment,
  useThreadReviewQueue,
} from "./review-queue";

/**
 * What the diff's lines need to take review comments: which lines already have one, and how to
 * add one. The comments are the thread's queue, kept in this browser until they are sent.
 */
export const useDiffReview = (
  threadId: string,
): { review: DiffReviewContextValue; comments: ThreadReviewComment[] } => {
  const comments = useThreadReviewQueue(threadId);
  const addComment = useCallback(
    (path: string, line: SessionDiffLine, note: string) => {
      addThreadReviewComment(threadId, {
        path,
        lineType: line.type,
        oldNo: line.oldNo,
        newNo: line.newNo,
        excerpt: diffLineExcerpt(line.text),
        note,
      });
    },
    [threadId],
  );
  const review = useMemo<DiffReviewContextValue>(
    () => ({
      commentedKeys: new Set(
        comments.map((comment) =>
          diffLineCommentKey(comment.path, {
            type: comment.lineType,
            oldNo: comment.oldNo,
            newNo: comment.newNo,
          }),
        ),
      ),
      addComment,
    }),
    [comments, addComment],
  );
  return { review, comments };
};
