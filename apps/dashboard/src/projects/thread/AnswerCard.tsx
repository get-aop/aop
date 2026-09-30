import type { Thread } from "@aop/common";
import { HandIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Composer } from "../chat/Composer";
import type { SendResult } from "../chat/project-chat";

type Waiting = Extract<Thread, { status: "waiting-on-you" }>;

/**
 * The question a thread stopped on, with each option it offered as a button and a box for an
 * answer of the person's own. Either way the answer goes to the thread, which picks up in the
 * same session. Nothing here changes the thread: the host does, and the page follows.
 */
export const AnswerCard = ({
  thread,
  answer,
  disabledReason,
}: {
  thread: Waiting;
  answer: (text: string) => Promise<SendResult>;
  disabledReason: string | null;
}) => {
  const { question, options } = thread.blockedQuestion;
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (label: string) => {
    setSending(label);
    setError(null);
    const result = await answer(label);
    setSending(null);
    if (!result.ok) setError(result.error);
  };

  return (
    <section
      data-testid="answer-card"
      aria-label="The thread is waiting on you"
      className="flex flex-col gap-3 rounded-card border border-waiting/40 bg-raised p-4"
    >
      <header className="flex items-start gap-2.5">
        <HandIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-waiting" />
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-waiting">Waiting on you</p>
          <p data-testid="answer-question" className="mt-0.5 text-[14px] leading-snug text-text">
            {question}
          </p>
        </div>
      </header>
      {options.length > 0 ? (
        <ul data-testid="answer-options" className="flex flex-wrap gap-2">
          {options.map(({ label, recommended }) => (
            <li key={label}>
              <Button
                type="button"
                size="sm"
                variant={recommended ? "default" : "outline"}
                data-testid="answer-option"
                data-recommended={recommended}
                disabled={sending !== null || disabledReason !== null}
                onClick={() => void choose(label)}
                className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
              >
                {label}
                {recommended ? (
                  <span className="text-[11px] font-normal opacity-70">Recommended</span>
                ) : null}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" data-testid="answer-error" className="text-[12px] text-blocked">
          {error}
        </p>
      ) : null}
      <Composer
        key={thread.id}
        draftId={`${thread.id}:answer`}
        placeholder={options.length > 0 ? "Or write your own answer…" : "Write your answer…"}
        disabledReason={disabledReason}
        send={answer}
        compact
      />
    </section>
  );
};
