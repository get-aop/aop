import type { QuestionBlock, QuestionOption } from "@aop/common";
import { CheckIcon, PencilIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { focusCoordinatorComposer } from "./focus-composer";
import {
  type QuestionAnswer,
  type QuestionAnswering,
  useQuestionAnswering,
} from "./question-answers";

/** Open: waits for a click. Shown: drawn outside the coordinator chat, where nobody answers it. */
type State = "open" | "sending" | "answered" | "shown";

/**
 * A question the coordinator asked with ask_person, under its reply: each option is a button
 * that sends its label as the person's reply, and "Other" puts the cursor in the box for an
 * answer of their own. Once the person has said anything after the question, by a click or by
 * typing, the buttons are off and the one they chose stays marked. The host keeps no answer; the
 * conversation is the record (see `answersOf`), so every device and a reload show the same.
 */
export const AskedQuestion = ({
  messageId,
  block,
}: {
  /** The coordinator message the question is in. */
  messageId: string;
  block: QuestionBlock;
}) => {
  const answering = useQuestionAnswering();
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();

  const answer = answering?.answers.get(messageId);
  const state = stateOf(answering, answer, sending);
  const blockedBy = answering?.disabledReason ?? null;
  const usable = state === "open" && blockedBy === null;

  const choose = async (label: string) => {
    if (!answering) return;
    setSending(label);
    setError(null);
    const result = await answering.answer(label);
    // A sent answer keeps its button busy until the message is in the chat and closes the question.
    if (!result.ok) {
      setSending(null);
      setError(result.error);
    }
  };

  return (
    <section
      data-testid="asked-question"
      data-state={state}
      aria-labelledby={headingId}
      className="my-2 flex max-w-xl flex-col gap-2"
    >
      <p
        id={headingId}
        data-testid="asked-question-text"
        className="text-body font-medium text-text"
      >
        {block.question}
      </p>
      <ul data-testid="asked-question-options" className="flex flex-wrap gap-2">
        {block.options.map((option) => (
          <li key={option.label} className="max-w-full">
            <OptionButton
              option={option}
              answered={state === "answered"}
              chosen={answer?.choice === option.label}
              sending={state === "sending" && sending === option.label}
              disabled={!usable}
              title={blockedBy}
              onChoose={() => void choose(option.label)}
            />
          </li>
        ))}
        {block.other ? (
          <li>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="asked-question-other"
              disabled={!usable}
              title={blockedBy ?? "Type your own answer in the box below"}
              onClick={focusCoordinatorComposer}
              className="h-auto min-h-8"
            >
              <PencilIcon aria-hidden="true" className="size-3.5" />
              Other…
            </Button>
          </li>
        ) : null}
      </ul>
      {answer && answer.choice === null ? (
        <p data-testid="asked-question-own-answer" className="text-meta text-text-muted">
          You answered in your own words.
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="asked-question-error" className="text-meta text-blocked">
          {error}
        </p>
      ) : null}
    </section>
  );
};

const stateOf = (
  answering: QuestionAnswering | null,
  answer: QuestionAnswer | undefined,
  sending: string | null,
): State => {
  if (!answering) return "shown";
  if (answer) return "answered";
  return sending === null ? "open" : "sending";
};

// The recommended option is the filled button while the question is open; once it is answered,
// the one the person chose is the one that stands out.
const OptionButton = ({
  option: { label, recommended },
  answered,
  chosen,
  sending,
  disabled,
  title,
  onChoose,
}: {
  option: QuestionOption;
  answered: boolean;
  chosen: boolean;
  sending: boolean;
  disabled: boolean;
  title: string | null;
  onChoose: () => void;
}) => (
  <Button
    type="button"
    size="sm"
    variant={recommended && !answered ? "default" : "outline"}
    data-testid="asked-question-option"
    data-recommended={recommended ? "true" : undefined}
    data-chosen={chosen ? "true" : undefined}
    aria-pressed={answered ? chosen : undefined}
    aria-busy={sending}
    disabled={disabled}
    title={title ?? undefined}
    onClick={onChoose}
    className={cn(
      "h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left",
      chosen && "border-running text-text disabled:opacity-100",
    )}
  >
    {sending ? <Spinner aria-hidden="true" className="size-3.5" /> : null}
    {chosen ? <CheckIcon aria-hidden="true" className="size-3.5 text-running" /> : null}
    {label}
    {recommended ? <span className="text-xs font-normal opacity-70">Recommended</span> : null}
  </Button>
);
