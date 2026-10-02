import type { PullRequestViewDetail } from "@aop/common";
import { MessageSquareIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Textarea } from "@/ui/textarea";

/** The question the popover suggests: what an open pull request still needs, or what a done one left. */
export const suggestedQuestion = (state: PullRequestViewDetail["state"]): string =>
  state === "open"
    ? "Where does this stand, and what does it need before it can merge?"
    : "What did this change, and is anything left to follow up on?";

/** The message the coordinator gets: the person's question, then which pull request, with its link. */
export const coordinatorMessage = (
  detail: Pick<PullRequestViewDetail, "number" | "title" | "url" | "nameWithOwner" | "state">,
  question: string,
): string =>
  `${question.trim() || suggestedQuestion(detail.state)}\n\nPull request ${detail.nameWithOwner}#${detail.number} “${detail.title}”: ${detail.url}`;

/**
 * "Ask the coordinator about this PR": a question (one is suggested) sent to the project's
 * coordinator with the pull request's link. Any client may ask, as it may in the chat itself.
 */
export const AskCoordinator = ({
  detail,
  onAsk,
}: {
  detail: PullRequestViewDetail;
  onAsk: (question: string) => Promise<boolean>;
}) => {
  const [open, setOpen] = useState(false);
  // Only what the person typed is kept; until then the suggestion follows the pull request's state.
  const [draft, setDraft] = useState<string | null>(null);
  const question = draft ?? suggestedQuestion(detail.state);
  const [sending, setSending] = useState(false);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      if (await onAsk(question)) {
        setOpen(false);
        setDraft(null);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" data-testid="pr-ask-coordinator">
          <MessageSquareIcon />
          <span className="hidden @5xl:inline">Ask the coordinator</span>
          <span className="@5xl:hidden">Ask</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form onSubmit={send} className="flex flex-col gap-2" data-testid="pr-ask-form">
          <label htmlFor="pr-ask-question" className="text-meta font-medium text-text">
            Ask the coordinator about #{detail.number}
          </label>
          <Textarea
            id="pr-ask-question"
            data-testid="pr-ask-question"
            value={question}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send(event);
            }}
          />
          <p className="text-meta text-text-subtle">The pull request's link goes with it.</p>
          <Button
            type="submit"
            size="sm"
            disabled={sending}
            data-testid="pr-ask-send"
            className="self-end"
          >
            {sending ? "Sending…" : "Send to the coordinator"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
};
