import type { SessionReviewComment } from "./session-review-queue";

/** Human-readable line label: new line number, or `old line N` for deleted rows. */
export const reviewCommentLineLabel = (
  comment: Pick<SessionReviewComment, "oldNo" | "newNo">,
): string => {
  if (comment.newNo !== null) return String(comment.newNo);
  if (comment.oldNo !== null) return `old line ${comment.oldNo}`;
  return "0";
};

/**
 * Serializes queued review comments plus the user's typed text into one message.
 * Deterministic: sorted by path, then line number, then insertion order.
 */
export const serializeReviewMessage = (
  comments: SessionReviewComment[],
  userText: string,
): string => {
  if (comments.length === 0) return userText;
  const blocks = sortComments(comments).map(commentBlock);
  const body = `Review comments on the current diff:\n\n${blocks.join("\n\n")}`;
  return userText ? `${body}\n\n${userText}` : body;
};

const sortComments = (comments: SessionReviewComment[]): SessionReviewComment[] =>
  [...comments].sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    const lineA = a.newNo ?? a.oldNo ?? 0;
    const lineB = b.newNo ?? b.oldNo ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    return a.createdAt - b.createdAt;
  });

const commentBlock = (comment: SessionReviewComment): string => {
  const fence = fenceFor(comment.excerpt);
  return `### ${comment.path}:${reviewCommentLineLabel(comment)}\n${fence}\n${comment.excerpt}\n${fence}\n${comment.note}`;
};

/** Backtick fence one longer than any run in the content, so excerpts can't break it. */
const fenceFor = (content: string): string => {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 2);
  return "`".repeat(longest + 1);
};
