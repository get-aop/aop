import type { SuggestedThread } from "@aop/common";
import { CheckIcon, LightbulbIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { useChatApi } from "./chat-api";
import { useChatContext } from "./chat-context";
import { ThreadChip } from "./ThreadChip";

type Failures = Readonly<Record<string, string>>;

const NOT_ACTIVE = "Resume the project to start threads.";

/**
 * Threads the coordinator proposes instead of starting: each can be started or skipped, and
 * "Start all" starts the ones still waiting. Nothing runs until one is started. The host records
 * every answer and publishes the message again, so what a row shows is what the host holds, on
 * every device alike; a click asks the host and the row changes when the answer arrives.
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
      className="my-2 max-w-xl overflow-hidden rounded-card border border-border bg-raised"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <LightbulbIcon aria-hidden="true" className="size-3.5 text-text-subtle" />
        <h4 className="flex-1 text-[12.5px] font-medium text-text-muted">Suggested threads</h4>
        {waiting.length > 1 ? (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            data-testid="suggestions-start-all"
            disabled={!projectActive || anyStarting}
            title={projectActive ? undefined : NOT_ACTIVE}
            onClick={() => void startAll()}
          >
            Start all
          </Button>
        ) : null}
      </header>
      <ul className="divide-y divide-border">
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
    </section>
  );
};

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
      className={cn("flex flex-col gap-1 px-3 py-2.5", state === "skipped" && "opacity-60")}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            data-testid="suggestion-title"
            className="text-[13.5px] font-medium leading-snug text-text"
          >
            {suggestion.title}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-text-muted">
            {suggestion.prompt}
          </p>
        </div>
        <RowActions
          state={state}
          disabled={disabled}
          onStart={onStart}
          onSkip={onSkip}
          onUndo={onUndo}
        />
      </div>
      {answer?.state === "started" ? (
        <p
          className="flex items-center gap-1.5 text-[12px] text-ok"
          data-testid="suggestion-started"
        >
          <CheckIcon aria-hidden="true" className="size-3.5" />
          Started
          <ThreadChip threadId={answer.threadId} />
        </p>
      ) : null}
      {failure ? (
        <p role="alert" data-testid="suggestion-error" className="text-[12px] text-blocked">
          {failure}
        </p>
      ) : null}
    </li>
  );
};

const RowActions = ({
  state,
  disabled,
  onStart,
  onSkip,
  onUndo,
}: {
  state: RowState;
  disabled: boolean;
  onStart: () => void;
  onSkip: () => void;
  onUndo: () => void;
}) => {
  if (state === "started") return null;
  if (state === "skipped") {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[12px] text-text-subtle">Skipped</span>
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
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        data-testid="suggestion-skip"
        disabled={state === "starting"}
        onClick={onSkip}
      >
        Skip
      </Button>
      <Button
        type="button"
        size="xs"
        variant="secondary"
        data-testid="suggestion-start"
        disabled={disabled || state === "starting"}
        title={disabled ? NOT_ACTIVE : undefined}
        onClick={onStart}
      >
        {state === "starting" ? "Starting…" : "Start"}
      </Button>
    </div>
  );
};
