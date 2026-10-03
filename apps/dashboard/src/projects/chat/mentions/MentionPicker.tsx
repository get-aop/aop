import { shownThreadStatus } from "@aop/common";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { pullRequestOf, THREAD_STATUS_LABEL } from "../../selectors";
import { ThreadStatusDot } from "../../ThreadStatusDot";
import type { MentionResult, Range } from "./mention-search";
import type { MentionPickerState } from "./use-mentions";

/**
 * The threads an `@` finds, above the composer: each with its state, title, pull request and a
 * line of its brief, the words typed lit up. Resolved threads come after the others, under their
 * own heading. The box keeps the focus; the option the arrows are on is `aria-activedescendant`.
 */
export const MentionPicker = ({ picker }: { picker: MentionPickerState }) => {
  const list = useRef<HTMLDivElement>(null);
  const activeId = picker.results.length > 0 ? picker.optionId(picker.active) : null;

  useEffect(() => {
    if (!activeId) return;
    list.current?.querySelector(`[id="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const firstResolved = picker.results.findIndex((result) => result.thread.status === "resolved");
  return (
    <div
      data-testid="mention-picker"
      className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-card border border-border-strong bg-raised shadow-lg"
    >
      <p className="border-b border-border px-3 py-1.5 text-meta text-text-subtle">
        {picker.query ? `Threads matching “${picker.query}”` : "Mention a thread"}
      </p>
      <div
        ref={list}
        id={picker.listId}
        role="listbox"
        aria-label="Threads to mention"
        className="max-h-72 overflow-y-auto py-1"
      >
        {picker.results.length === 0 ? (
          <p data-testid="mention-picker-empty" className="px-3 py-2 text-meta text-text-subtle">
            No thread matches.
          </p>
        ) : (
          picker.results.map((result, at) => (
            <MentionOptionRow
              key={result.thread.id}
              result={result}
              id={picker.optionId(at)}
              active={at === picker.active}
              heading={at === firstResolved && at > 0 ? "Resolved" : null}
              onPick={() => picker.pick(at)}
              onHover={() => picker.hover(at)}
            />
          ))
        )}
      </div>
      <p className="border-t border-border px-3 py-1 text-meta text-text-subtle">
        ↑↓ to move · Enter or Tab to mention · Esc to close
      </p>
    </div>
  );
};

const MentionOptionRow = ({
  result,
  id,
  active,
  heading,
  onPick,
  onHover,
}: {
  result: MentionResult;
  id: string;
  active: boolean;
  heading: string | null;
  onPick: () => void;
  onHover: () => void;
}) => {
  const { thread, snippet } = result;
  const status = shownThreadStatus(thread);
  const pullRequest = pullRequestOf(thread);
  return (
    <>
      {heading ? (
        <p
          role="presentation"
          data-testid="mention-picker-heading"
          className="mt-1 border-t border-border px-3 pb-0.5 pt-1.5 text-meta font-medium text-text-subtle"
        >
          {heading}
        </p>
      ) : null}
      <div
        id={id}
        role="option"
        aria-selected={active}
        tabIndex={-1}
        data-testid="mention-option"
        data-thread-id={thread.id}
        data-active={active || undefined}
        // Picking must not take the focus from the box, which the mention goes into.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPick}
        onKeyDown={(event) => {
          if (event.key === "Enter") onPick();
        }}
        onMouseMove={active ? undefined : onHover}
        className={cn(
          "mx-1 flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5",
          active && "bg-hover",
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-body">
          <ThreadStatusDot status={status} />
          <span
            data-testid="mention-option-title"
            className="min-w-0 truncate font-medium text-text"
          >
            <Lit text={thread.title} ranges={result.titleRanges} />
          </span>
          {pullRequest ? (
            <span data-testid="mention-option-pr" className="shrink-0 text-meta text-text-muted">
              #{pullRequest.number}
            </span>
          ) : null}
          <span
            data-testid="mention-option-status"
            className={cn(
              "ml-auto shrink-0 text-meta text-text-subtle",
              status === "waiting-on-you" && "text-waiting",
            )}
          >
            {THREAD_STATUS_LABEL[status]}
          </span>
        </span>
        {snippet ? (
          <span
            data-testid="mention-option-snippet"
            className="truncate pl-4 text-meta text-text-subtle"
          >
            <Lit text={snippet.text} ranges={snippet.ranges} />
          </span>
        ) : null}
      </div>
    </>
  );
};

/** `text` with the ranges the search matched in bold. */
const Lit = ({ text, ranges }: { text: string; ranges: readonly Range[] }) => {
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <mark
        key={from}
        data-testid="mention-match"
        className="bg-transparent font-semibold text-text"
      >
        {text.slice(from, to)}
      </mark>,
    );
    at = to;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
};
