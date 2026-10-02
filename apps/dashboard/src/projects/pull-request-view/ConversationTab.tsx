import type { PullRequestViewDetail } from "@aop/common";
import { CheckIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Textarea } from "@/ui/textarea";
import { Avatar } from "./bits";
import { MergeBox } from "./MergeBox";
import { CommentCard, ReviewThreads, Timeline } from "./Timeline";
import type { PullRequestActions } from "./use-pull-request-actions";

/**
 * The Conversation tab: the description, the timeline (comments, reviews, commits, events), the
 * line-level review conversations, the merge box, and the host owner's comment and review box.
 */
export const ConversationTab = ({
  detail,
  actions,
}: {
  detail: PullRequestViewDetail;
  actions: PullRequestActions;
}) => (
  <div data-testid="pr-conversation-tab" className="flex flex-col gap-5">
    <CommentCard
      testId="pr-description"
      comment={{
        author: detail.author,
        body: detail.body,
        createdAt: detail.createdAt,
        url: detail.url,
      }}
      verb="opened this"
    />
    {detail.timelineOmitted > 0 ? (
      <p data-testid="pr-timeline-omitted" className="pl-[52px] text-meta text-text-subtle">
        {detail.timelineOmitted.toLocaleString()} earlier{" "}
        {detail.timelineOmitted === 1 ? "event is" : "events are"} only on GitHub.{" "}
        <a
          href={detail.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-running hover:underline"
        >
          See them on GitHub
        </a>
      </p>
    ) : null}
    <Timeline items={detail.timeline} />
    <ReviewThreads threads={detail.reviewThreads} />
    <div className="pl-[52px]">
      <MergeBox detail={detail} actions={actions} />
    </div>
    {actions.canWrite ? <CommentBox detail={detail} actions={actions} /> : null}
  </div>
);

/**
 * Comment, or review: approve or request changes, with the text as the review's body. GitHub
 * refuses an author's review of their own pull request; that refusal is shown as it comes.
 */
const CommentBox = ({
  detail,
  actions,
}: {
  detail: PullRequestViewDetail;
  actions: PullRequestActions;
}) => {
  const [body, setBody] = useState("");
  const busy = actions.pending !== null;
  const ownPullRequest = detail.author?.login === detail.viewer.login;

  const send = async (run: () => Promise<boolean>) => {
    if (await run()) setBody("");
  };

  return (
    <section data-testid="pr-comment-box" aria-label="Add a comment" className="flex gap-3">
      <Avatar
        user={detail.viewer.login ? { login: detail.viewer.login, avatarUrl: null } : null}
        size={40}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-body font-semibold text-text">Add a comment</h3>
        <Textarea
          data-testid="pr-comment-input"
          aria-label="Comment"
          value={body}
          rows={4}
          placeholder="Leave a comment (markdown)"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && body.trim()) {
              event.preventDefault();
              void send(() => actions.comment(body));
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {detail.state === "open" && !ownPullRequest ? (
            <ReviewButtons body={body} actions={actions} send={send} />
          ) : null}
          <Button
            size="sm"
            data-testid="pr-comment-submit"
            disabled={busy || !body.trim()}
            onClick={() => void send(() => actions.comment(body))}
          >
            <MessageSquareIcon />
            {actions.pending === "comment" ? "Commenting…" : "Comment"}
          </Button>
        </div>
        {ownPullRequest && detail.state === "open" ? (
          <p className="text-right text-meta text-text-subtle">
            GitHub does not let the author approve or request changes on their own pull request.
          </p>
        ) : null}
      </div>
    </section>
  );
};

const ReviewButtons = ({
  body,
  actions,
  send,
}: {
  body: string;
  actions: PullRequestActions;
  send: (run: () => Promise<boolean>) => Promise<void>;
}) => {
  const busy = actions.pending !== null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        data-testid="pr-request-changes"
        disabled={busy || !body.trim()}
        title={body.trim() ? undefined : "Say what to change first"}
        onClick={() => void send(() => actions.review("REQUEST_CHANGES", body))}
      >
        <XIcon className="text-blocked" />
        {actions.pending === "request-changes" ? "Sending…" : "Request changes"}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        data-testid="pr-approve"
        disabled={busy}
        onClick={() => void send(() => actions.review("APPROVE", body))}
      >
        <CheckIcon className="text-ok" />
        {actions.pending === "approve" ? "Approving…" : "Approve"}
      </Button>
    </>
  );
};
