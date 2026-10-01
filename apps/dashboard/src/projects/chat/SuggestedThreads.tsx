import type { SuggestedThread } from "@aop/common";
import { CheckIcon, CornerDownLeftIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { useChatApi } from "./chat-api";
import { useChatContext } from "./chat-context";
import { ThreadChip } from "./ThreadChip";

type Failures = Readonly<Record<string, string>>;

const NOT_ACTIVE = "Resume the project to start threads.";

/**
 * Threads the coordinator proposes instead of starting: each row is a title and one line of
 * reason, started with its own button, and "Start N threads" starts the ones still waiting.
 * Skipping is a quiet control that shows on hover. Nothing runs until one is started. The host
 * records every answer and publishes the message again, so what a row shows is what the host
 * holds, on every device alike; a click asks the host and the row changes when the answer arrives.
 */
export const SuggestedThreads = ({
  messageId,
  suggestions,
}: {
  /** The coordinator message the proposals are in; an answer is recorded against it. */
  messageId: string;
  suggestions: readonly SuggestedThread[];
}) => {
  const { projectId, projectActive } = useChatContext();
  const api = useChatApi();
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<Failures>({});

  const attempt = async (suggestionId: string, run: () => Promise<unknown>): Promise<void> => {
    setFailures(({ [suggestionId]: _cleared, ...rest }) => rest);
    try {
      await run();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Could not reach the host";
      setFailures((current) => ({ ...current, [suggestionId]: reason }));
    }
  };

  const start = async (suggestion: SuggestedThread): Promise<void> => {
    setStarting((current) => new Set(current).add(suggestion.id));
    await attempt(suggestion.id, () => api.startSuggestion(projectId, messageId, suggestion.id));
    setStarting((current) => {
      const next = new Set(current);
      next.delete(suggestion.id);
      return next;
    });
  };

  const waiting = suggestions.filter(({ answer }) => !answer);
  // One after the other: each start is a thread on the host, and the order they were proposed in is the order they appear in.
  const startAll = async () => {
    for (const suggestion of waiting) await start(suggestion);
  };
  const anyStarting = starting.size > 0;

  return (
    <section
      data-testid="suggested-threads"
      className="my-2 flex max-w-xl flex-col gap-1 rounded-card border border-border px-4 pt-3 pb-4"
    >
      <h4 className="text-meta text-text-muted">Suggested threads</h4>
      <ul className="-mx-2 flex flex-col">
        {suggestions.map((suggestion) => (
          <SuggestionRow
            key={suggestion.id}
            suggestion={suggestion}
            starting={starting.has(suggestion.id)}
            failure={failures[suggestion.id]}
            disabled={!projectActive}
            onStart={() => void start(suggestion)}
            onSkip={() =>
              void attempt(suggestion.id, () =>
                api.skipSuggestion(projectId, messageId, suggestion.id),
              )
            }
            onUndo={() =>
              void attempt(suggestion.id, () =>
                api.unskipSuggestion(projectId, messageId, suggestion.id),
              )
            }
          />
        ))}
      </ul>
      {waiting.length > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="suggestions-start-all"
          className="mt-1 self-start text-body font-normal"
          disabled={!projectActive || anyStarting}
          title={projectActive ? undefined : NOT_ACTIVE}
          onClick={() => void startAll()}
        >
          {startAllLabel(waiting.length)}
        </Button>
      ) : null}
    </section>
  );
};

const startAllLabel = (count: number): string =>
  count === 1 ? "Start 1 thread" : `Start ${count} threads`;

type RowState = "pending" | "starting" | "started" | "skipped";

const rowState = (answer: SuggestedThread["answer"], starting: boolean): RowState =>
  answer?.state ?? (starting ? "starting" : "pending");

const SuggestionRow = ({
  suggestion,
  starting,
  failure,
  disabled,
  onStart,
  onSkip,
  onUndo,
}: {
  suggestion: SuggestedThread;
  starting: boolean;
  failure: string | undefined;
  disabled: boolean;
  onStart: () => void;
  onSkip: () => void;
  onUndo: () => void;
}) => {
  const { answer } = suggestion;
  const state = rowState(answer, starting);
  return (
    <li
      data-testid="suggestion"
      data-suggestion-id={suggestion.id}
      data-state={state}
      className="group/suggestion flex flex-col gap-1 rounded-row px-2 py-2 transition-colors duration-[120ms] hover:bg-hover"
    >
      <div className="flex items-center gap-3">
        <div className={cn("min-w-0 flex-1", state === "skipped" && "opacity-60")}>
          <p data-testid="suggestion-title" className="text-body text-text">
            {suggestion.title}
          </p>
          {suggestion.reason ? (
            <p data-testid="suggestion-reason" className="truncate text-meta text-text-muted">
              {suggestion.reason}
            </p>
          ) : null}
        </div>
        <RowActions
          title={suggestion.title}
          state={state}
          disabled={disabled}
          onStart={onStart}
          onSkip={onSkip}
          onUndo={onUndo}
        />
      </div>
      {answer?.state === "started" ? (
        <p className="flex items-center gap-1.5 text-meta text-ok" data-testid="suggestion-started">
          <CheckIcon aria-hidden="true" className="size-3.5" />
          Started
          <ThreadChip threadId={answer.threadId} />
        </p>
      ) : null}
      {failure ? (
        <p role="alert" data-testid="suggestion-error" className="text-meta text-blocked">
          {failure}
        </p>
      ) : null}
    </li>
  );
};

// Skip stays out of the way until the row is hovered or focused; a touch screen has no hover, so there it always shows.
const QUIET =
  "opacity-0 transition-opacity duration-[120ms] group-hover/suggestion:opacity-100 group-focus-within/suggestion:opacity-100 pointer-coarse:opacity-100";

const RowActions = ({
  title,
  state,
  disabled,
  onStart,
  onSkip,
  onUndo,
}: {
  title: string;
  state: RowState;
  disabled: boolean;
  onStart: () => void;
  onSkip: () => void;
  onUndo: () => void;
}) => {
  if (state === "started") return null;
  if (state === "skipped") {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-meta text-text-subtle">Skipped</span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          data-testid="suggestion-undo"
          onClick={onUndo}
        >
          Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        data-testid="suggestion-skip"
        className={QUIET}
        disabled={state === "starting"}
        onClick={onSkip}
      >
        Skip
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        data-testid="suggestion-start"
        aria-label={state === "starting" ? `Starting ${title}` : `Start ${title}`}
        aria-busy={state === "starting"}
        disabled={disabled || state === "starting"}
        title={disabled ? NOT_ACTIVE : "Start this thread"}
        onClick={onStart}
      >
        {state === "starting" ? (
          <Spinner aria-hidden="true" className="size-3.5" />
        ) : (
          <CornerDownLeftIcon aria-hidden="true" className="size-4" />
        )}
      </Button>
    </div>
  );
};
