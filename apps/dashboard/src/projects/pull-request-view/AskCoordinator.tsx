import type { PullRequestViewDetail } from "@aop/common";
import { MessageSquareIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Textarea } from "@/ui/textarea";

export const DEFAULT_QUESTION = "Where does this stand, and what does it need before it can merge?";

/** The message the coordinator gets: the person's question, then which pull request, with its link. */
export const coordinatorMessage = (
  detail: Pick<PullRequestViewDetail, "number" | "title" | "url" | "nameWithOwner">,
  question: string,
): string =>
  `${question.trim() || DEFAULT_QUESTION}\n\nPull request ${detail.nameWithOwner}#${detail.number} “${detail.title}”: ${detail.url}`;

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
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [sending, setSending] = useState(false);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      if (await onAsk(question)) setOpen(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" data-testid="pr-ask-coordinator">
          <MessageSquareIcon />
          <span className="hidden @2xl:inline">Ask the coordinator</span>
          <span className="@2xl:hidden">Ask</span>
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
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send(event);
            }}
          />
          <p className="text-meta text-text-subtle">The pull request's link goes with it.</p>
          <Button type="submit" size="sm" disabled={sending} data-testid="pr-ask-send" className="self-end">
            {sending ? "Sending…" : "Send to the coordinator"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
};
